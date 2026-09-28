#!/usr/bin/env node
// E2E: run the parallel-worktrees skill for real. The main agent acts as coordinator:
// it creates one git worktree + agent/<slug> branch per bug, spawns one worker per
// worktree with cwd set, and reviews. This script then verifies the result on disk,
// never trusting the agent's own report.
//
//   node e2e/worktrees.mjs <provider/model>
//
// The toy repo is created under os.tmpdir() (NOT under this repo: pi walks ancestors
// for AGENTS.md) and kept after the run; its path is printed. Artifacts (event log,
// task files, per-branch log/diff, summary) go to e2e/artifacts/worktrees-<ts>/.

import { spawn, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const model = process.argv[2];
if (!model) throw new Error("usage: node e2e/worktrees.mjs <provider/model>");

const artifacts = path.join(root, "e2e", "artifacts", `worktrees-${new Date().toISOString().replace(/[:.]/g, "-")}`);
fs.mkdirSync(artifacts, { recursive: true });
const log = fs.createWriteStream(path.join(artifacts, "events.jsonl"));

// ---------- toy repo: two independent bugs ----------

const toy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pi-wt-e2e-")), "toy");
fs.mkdirSync(path.join(toy, "test"), { recursive: true });
fs.writeFileSync(path.join(toy, "package.json"), '{"name":"toy","type":"module","scripts":{"test":"node --test"}}\n');
fs.writeFileSync(path.join(toy, "math.js"), "export function add(a, b) {\n\treturn a - b;\n}\n");
fs.writeFileSync(path.join(toy, "strings.js"), 'export function shout(s) {\n\treturn s.toLowerCase() + "!";\n}\n');
fs.writeFileSync(
	path.join(toy, "test", "math.test.js"),
	'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../math.js";\n\ntest("add", () => {\n\tassert.equal(add(2, 3), 5);\n});\n',
);
fs.writeFileSync(
	path.join(toy, "test", "strings.test.js"),
	'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { shout } from "../strings.js";\n\ntest("shout", () => {\n\tassert.equal(shout("hi"), "HI!");\n});\n',
);

const git = (args, cwd = toy) => execFileSync("git", args.split(" "), { cwd, encoding: "utf-8" }).trim();
git("init -b main");
git("add -A");
git("-c user.email=e2e@test -c user.name=e2e commit -qm init");
const baseSha = git("rev-parse HEAD");
const mathSrc = fs.readFileSync(path.join(toy, "math.js"), "utf-8");
const stringsSrc = fs.readFileSync(path.join(toy, "strings.js"), "utf-8");

// ---------- drive pi in rpc mode ----------

const pi = spawn(
	"pi",
	[
		"--mode", "rpc", "--no-session", "--no-extensions",
		"-e", path.join(root, "index.ts"),
		"--skill", path.join(root, "skills", "parallel-worktrees"),
		"--model", model,
	],
	{ cwd: toy, stdio: ["pipe", "pipe", "inherit"] },
);

let events = [];
let listeners = [];
let buf = "";
pi.stdout.on("data", (d) => {
	buf += d.toString();
	let i;
	while ((i = buf.indexOf("\n")) >= 0) {
		const line = buf.slice(0, i).replace(/\r$/, "");
		buf = buf.slice(i + 1);
		if (!line.trim()) continue;
		const ev = JSON.parse(line);
		log.write(`${line}\n`);
		events.push(ev);
		listeners.forEach((f) => f(ev));
	}
});

const send = (cmd) => pi.stdin.write(`${JSON.stringify(cmd)}\n`);
const until = (pred, ms, what) =>
	new Promise((resolve, reject) => {
		const hit = events.find(pred);
		if (hit) return resolve(hit);
		const t = setTimeout(() => reject(new Error(`timeout waiting for ${what}`)), ms);
		const f = (ev) => pred(ev) && (clearTimeout(t), (listeners = listeners.filter((x) => x !== f)), resolve(ev));
		listeners.push(f);
	});

const text = (m) =>
	typeof m?.content === "string" ? m.content : (m?.content ?? []).map((c) => c.text ?? "").join("");

const results = [];
function check(name, ok, info = "") {
	results.push({ name, ok, info });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? `  — ${info}` : ""}`);
}

// ---------- verification helpers ----------

const worktreeList = () =>
	git("worktree list --porcelain")
		.split("\n\n")
		.map((block) => {
			const wt = /^worktree (.+)$/m.exec(block)?.[1];
			const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
			return wt && { path: fs.realpathSync(wt), branch };
		})
		.filter(Boolean);

const diffFiles = (branch) => git(`diff --name-only main...${branch}`).split("\n").filter(Boolean);

try {
	console.log(`model: ${model}\ntoy repo: ${toy}\nartifacts: ${path.relative(root, artifacts)}\n`);

	send({
		type: "prompt",
		message:
			"/skill:parallel-worktrees Fix these two bugs independently, one worktree and one worker each. " +
			"Bug 1: add() in math.js returns the wrong result; the check is `node --test test/math.test.js`. " +
			"Bug 2: shout() in strings.js must upper-case its input; the check is `node --test test/strings.test.js`. " +
			"There is no git remote, so stop at local branches. " +
			"Do not clean up the worktrees; I will inspect them.",
	});
	await until((e) => e.type === "agent_settled", 25 * 60_000, "agent_settled");

	// 1) workers were spawned into distinct real worktrees
	const spawnCwds = events
		.filter((e) => e.type === "tool_execution_start" && e.toolName === "spawn_agent")
		.map((e) => e.args?.cwd)
		.filter(Boolean)
		.map((p) => {
			try {
				return fs.realpathSync(path.resolve(toy, p));
			} catch {
				return path.resolve(toy, p);
			}
		});
	const wtPaths = new Set(worktreeList().map((w) => w.path));
	const distinct = [...new Set(spawnCwds)].filter((p) => wtPaths.has(p) && p !== fs.realpathSync(toy));
	check("spawn_agent used distinct worktree cwd", distinct.length >= 2, distinct.join(", "));

	// 2) extra worktrees on agent/* branches
	const agents = worktreeList().filter((w) => w.branch?.startsWith("agent/"));
	check("worktrees on agent/* branches", agents.length >= 2, agents.map((w) => `${w.branch}@${w.path}`).join(", "));
	check(
		"worktrees live in <toy>.worktrees",
		agents.every((w) => w.path.startsWith(`${fs.realpathSync(toy)}.worktrees/`)),
		agents.map((w) => w.path).join(", "),
	);

	const testCmds = events
		.filter((e) => e.type === "tool_execution_start" && e.toolName === "bash")
		.map((e) => e.args?.command ?? "")
		.filter((c) => c.includes("node --test"));
	const wtDirs = [toy, fs.realpathSync(toy)].map((t) => `${t}.worktrees/`);
	check(
		"coordinator ran checks inside worktrees",
		testCmds.length > 0 && testCmds.every((c) => wtDirs.some((d) => c.includes(d))),
		testCmds.join(" | "),
	);

	// 3) each bug fixed on exactly one branch, diffs stay separate
	const diffs = agents.map((w) => ({ ...w, files: diffFiles(w.branch) }));
	const mathWt = diffs.filter((d) => d.files.includes("math.js") && !d.files.includes("strings.js"));
	const stringsWt = diffs.filter((d) => d.files.includes("strings.js") && !d.files.includes("math.js"));
	check("exactly one branch fixes math.js only", mathWt.length === 1, mathWt.map((d) => d.branch).join(", "));
	check("exactly one branch fixes strings.js only", stringsWt.length === 1, stringsWt.map((d) => d.branch).join(", "));

	// 4) task state never enters a commit
	const leaked = diffs.flatMap((d) => d.files.filter((f) => f.endsWith("pi-task.md") || f.startsWith(".pi/")));
	check("no pi-task.md or .pi/ in branch diffs", leaked.length === 0, leaked.join(", "));

	// 5) each agent branch is ahead of main
	const ahead = agents.map((w) => Number(git(`rev-list --count main..${w.branch}`)));
	check("each agent branch is ahead of main", ahead.every((n) => n >= 1), ahead.join(", "));

	// 6) the promised check passes in each worktree
	for (const [list, file] of [[mathWt, "test/math.test.js"], [stringsWt, "test/strings.test.js"]]) {
		const wt = list[0];
		if (!wt) {
			check(`check runs in worktree for ${file}`, false, "no worktree");
			continue;
		}
		const r = spawnSyncSafe("node", ["--test", file], wt.path);
		check(`check passes in ${wt.branch}`, r.status === 0, r.stderr.slice(-200));
	}

	// 7) worktrees are clean (workers committed)
	const dirty = agents.filter((w) => git("status --porcelain", w.path) !== "");
	check("worktrees have no uncommitted changes", dirty.length === 0, dirty.map((d) => d.branch).join(", "));

	// 8) the main checkout is untouched
	check(
		"main checkout untouched",
		git("rev-parse HEAD") === baseSha &&
			git("status --porcelain") === "" &&
			fs.readFileSync(path.join(toy, "math.js"), "utf-8") === mathSrc &&
			fs.readFileSync(path.join(toy, "strings.js"), "utf-8") === stringsSrc,
	);

	// 9) per-worktree task file exists outside the tree and holds the task
	for (const w of agents) {
		const taskFile = git("rev-parse --path-format=absolute --git-path pi-task.md", w.path);
		const content = fs.existsSync(taskFile) ? fs.readFileSync(taskFile, "utf-8") : "";
		check(`task file for ${w.branch}`, content.includes("## Goal"), taskFile);
		if (content) fs.writeFileSync(path.join(artifacts, `pi-task-${w.branch.replace(/\//g, "-")}.md`), content);
	}

	// 10) workers must not push or open PRs; the coordinator stops at local branches here
	const pushed = events
		.filter((e) => e.type === "tool_execution_start" && e.toolName === "bash")
		.map((e) => e.args?.command ?? "")
		.filter((cmd) => cmd.includes("gh pr create") || cmd.includes("git push"));
	check("no git push or gh pr create", pushed.length === 0, pushed[0]);

	// 11) the coordinator actually collected worker results
	check(
		"coordinator received worker results",
		events.some((e) => e.type === "tool_execution_start" && e.toolName === "wait_agents") ||
			events.some((e) => e.type === "message_end" && e.message?.customType === "subagent-result"),
	);

	// per-branch artifacts
	for (const w of agents) {
		const slug = w.branch.replace(/\//g, "-");
		fs.writeFileSync(path.join(artifacts, `log-${slug}.txt`), git(`log --oneline main..${w.branch}`));
		fs.writeFileSync(path.join(artifacts, `diff-${slug}.patch`), git(`diff main...${w.branch}`));
	}
} catch (e) {
	check("run completed", false, String(e));
} finally {
	pi.kill();
	const failed = results.filter((r) => !r.ok).length;
	fs.writeFileSync(
		path.join(artifacts, "summary.json"),
		JSON.stringify({ model, toy, results }, null, 2),
	);
	console.log(`\ntoy repo kept at: ${toy}`);
	console.log(`${results.length - failed}/${results.length} passed`);
	process.exit(failed ? 1 : 0);
}

function spawnSyncSafe(cmd, args, cwd) {
	try {
		execFileSync(cmd, args, { cwd, stdio: "pipe" });
		return { status: 0, stderr: "" };
	} catch (e) {
		return { status: e.status ?? 1, stderr: String(e.stderr ?? e) };
	}
}
