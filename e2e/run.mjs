#!/usr/bin/env node
// E2E: drive a real pi (RPC mode) with only this extension loaded and check the three
// delivery paths plus model inheritance. Writes the full event log to e2e/artifacts/.
//
//   node e2e/run.mjs [provider/model]     (default: $PI_PROVIDER/$PI_MODEL of the calling session)
//
// Uses real model calls (tiny prompts). Children inherit the parent's model, which is
// deliberately different from settings.json defaultModel so inheritance is observable.

import { spawn, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const model = process.argv[2] ?? `${process.env.PI_PROVIDER}/${process.env.PI_MODEL}`;
if (model.includes("undefined")) throw new Error("pass provider/model");
// Expected child model: settings.json simpleSubagent.model if set, else the parent's model.
const settingsFile = path.join(process.env.HOME, ".pi", "agent", "settings.json");
const configured = JSON.parse(fs.readFileSync(settingsFile, "utf-8")).simpleSubagent?.model;
const childModel = configured ?? model;
const artifacts = path.join(root, "e2e", "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const logFile = path.join(artifacts, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
const log = fs.createWriteStream(logFile);

// temp git repo + worktree for the cwd scenarios
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-simple-subagent-e2e-"));
const git = (args, cwd = tmp) => execSync(`git ${args}`, { cwd, encoding: "utf-8" }).trim();
git("init -b main");
git("-c user.email=e2e@test -c user.name=e2e commit --allow-empty -qm init");
git(`worktree add -b e2e-cwd ${path.join(tmp, "repo.worktrees", "wt")}`);
const WT = fs.realpathSync(path.join(tmp, "repo.worktrees", "wt"));

const pi = spawn(
	"pi",
	["--mode", "rpc", "--no-session", "--no-extensions", "-e", path.join(root, "index.ts"), "--model", model],
	{ cwd: root, stdio: ["pipe", "pipe", "inherit"] },
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const text = (m) =>
	typeof m?.content === "string" ? m.content : (m?.content ?? []).map((c) => c.text ?? "").join("");
const lastAssistant = () => text(events.filter((e) => e.type === "message_end" && e.message?.role === "assistant").at(-1)?.message);
const tools = (name) => events.filter((e) => e.type === "tool_execution_start" && e.toolName === name);
const resultMsgs = () => events.filter((e) => e.type === "message_end" && e.message?.customType === "subagent-result");

async function prompt(message, ms = 240_000) {
	events = [];
	send({ type: "prompt", message });
	await until((e) => e.type === "agent_settled", ms, "agent_settled");
}

const results = [];
function check(name, ok, info = "") {
	results.push({ name, ok, info });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? `  — ${info}` : ""}`);
}

try {
	console.log(`parent model: ${model}\nexpected child model: ${childModel}\nlog: ${path.relative(root, logFile)}\n`);

	// 1) busy -> results slip into the running turn; parallel; no waiting tool used
	await prompt(
		"Use spawn_agent twice, in the same turn, without an agent name: first task 'Reply with exactly the word ALPHA and nothing else.', " +
			"second task 'Reply with exactly the word BRAVO and nothing else.'. Do NOT call wait_agents. " +
			"Then run the bash command `sleep 45; echo slept`. After that, report the two words the subagents returned.",
	);
	const a1 = lastAssistant();
	const spawns1 = tools("spawn_agent");
	check("1 busy: two spawns", spawns1.length === 2, `${spawns1.length} spawn calls`);
	check("1 busy: no wait_agents", tools("wait_agents").length === 0);
	// both children finish during the sleep -> exactly one combined message, one extra turn at most
	const combined = resultMsgs().map((e) => text(e.message)).join("\n");
	check("1 busy: results batched into one message", resultMsgs().length === 1, `${resultMsgs().length} result messages`);
	check("1 busy: batch holds both results", /\[agent-1\]/.test(combined) && /\[agent-2\]/.test(combined));
	const afterBash = events.slice(events.findIndex((e) => e.type === "tool_execution_end" && e.toolName === "bash"));
	const turnsAfter = afterBash.filter((e) => e.type === "message_end" && e.message?.role === "assistant").length;
	check("1 busy: one model turn after bash (no per-result turns)", turnsAfter === 1, `${turnsAfter} turns`);
	check("1 busy: answer has ALPHA and BRAVO", /ALPHA/.test(a1) && /BRAVO/.test(a1), a1.slice(0, 120));
	const headers = combined.split("\n").filter((l) => /^\[agent-\d+\]/.test(l));
	check(`1 child model = ${configured ? "settings" : "parent session"} model`, headers.length === 2 && headers.every((h) => h.includes(`model ${childModel}`)), headers[0]);

	// 2) idle -> result is held (no new turn), then shows up with the next user message
	await prompt(
		"Use spawn_agent once with task 'Reply with exactly the word CHARLIE and nothing else.'. Do NOT wait. Then immediately reply with just OK and end your turn.",
	);
	events = [];
	await until((e) => e.type === "extension_ui_request" && e.method === "notify" && /agent-\d+/.test(e.message ?? ""), 180_000, "idle notify");
	await sleep(3000);
	check("2 idle: no turn started by the result", !events.some((e) => e.type === "agent_start"));
	await prompt("What word did that last subagent return? Answer with just the word.");
	const a2 = lastAssistant();
	check("2 idle: result included with next user message", /CHARLIE/.test(a2), a2.slice(0, 80));

	// 3) wait_agents collects the result; no duplicate delivery afterwards
	// (named agents are not E2E-covered: they would need a fixture in ~/.pi/agent/agents)
	await prompt(
		"Use spawn_agent with task 'Reply with exactly the word DELTA and nothing else.', then call wait_agents and tell me what it returned.",
	);
	const a3 = lastAssistant();
	check("3 wait: wait_agents used", tools("wait_agents").length >= 1);
	check("3 wait: answer has DELTA", /DELTA/.test(a3), a3.slice(0, 80));
	check("3 wait: no duplicate result message", resultMsgs().length === 0, `${resultMsgs().length} result messages`);

	// 4) cwd: the child pi process runs in the given worktree
	await prompt(
		`Use spawn_agent with cwd '${WT}' and task 'Run the bash commands \`pwd\` and \`git rev-parse --abbrev-ref HEAD\`, then reply with exactly their two output lines and nothing else.'. ` +
			"Then call wait_agents and repeat its answer verbatim.",
	);
	const a4 = lastAssistant();
	const spawnCwd = tools("spawn_agent").find((e) => e.args?.cwd === WT);
	check("4 cwd: spawn_agent got cwd", !!spawnCwd, JSON.stringify(tools("spawn_agent").map((e) => e.args)));
	const waitResult = events
		.filter((e) => e.type === "tool_execution_end" && e.toolName === "wait_agents")
		.map((e) => text(e.result))
		.join("\n");
	check("4 cwd: header shows cwd", waitResult.includes(`cwd ${WT}`), waitResult.split("\n")[0]);
	check("4 cwd: child ran in worktree", a4.includes(WT) && a4.includes("e2e-cwd"), a4.slice(0, 160));

	// 5) bad cwd: spawn_agent fails before starting a child
	await prompt(
		"Use spawn_agent with cwd '/nonexistent/pi-simple-subagent-e2e' and task 'Reply OK.'. " +
			"Report the exact error message you got. Do not retry.",
	);
	const badSpawn = events.find((e) => e.type === "tool_execution_end" && e.toolName === "spawn_agent");
	check(
		"5 bad cwd: spawn_agent errors",
		!!badSpawn?.isError && /not an existing directory/.test(text(badSpawn.result)),
		text(badSpawn?.result).slice(0, 120),
	);
	check("5 bad cwd: no subagent result", resultMsgs().length === 0 && tools("wait_agents").length === 0);

	// 6) wait_agents without ids returns as soon as the NEXT subagent finishes
	await prompt(
		"Use spawn_agent twice in the same turn: first task 'Reply with exactly the word FAST and nothing else.', " +
			"second task 'Run the bash command `sleep 60`, then reply with exactly the word SLOW and nothing else.'. " +
			"Then call wait_agents once with no ids. As soon as it returns, reply with the words you have received so far " +
			"and end your turn. Do not call wait_agents again.",
	);
	const spawnId = (kw) => {
		const start = tools("spawn_agent").find((e) => e.args?.task?.includes(kw));
		return events.find(
			(e) => e.type === "tool_execution_end" && e.toolName === "spawn_agent" && e.toolCallId === start?.toolCallId,
		)?.result?.details?.id;
	};
	const fastId = spawnId("FAST");
	const slowId = spawnId("SLOW");
	const waitRes6 = text(events.find((e) => e.type === "tool_execution_end" && e.toolName === "wait_agents")?.result);
	check(
		"6 next: first wait returns only the finished one",
		!!fastId && waitRes6.includes(`[${fastId}]`) && waitRes6.includes("FAST") && !waitRes6.includes(`[${slowId}]`),
		waitRes6.slice(0, 120),
	);
	check("6 next: lists the still-running id", !!slowId && waitRes6.includes("Still running:") && waitRes6.includes(slowId), waitRes6.slice(-120));
	const events6 = events.slice();
	await until(
		(e) => e.type === "extension_ui_request" && e.method === "notify" && String(e.message ?? "").includes(slowId),
		180_000,
		"idle notify for slow result",
	);
	events6.push(...events.slice(events6.length)); // idle-gap events (the nextTurn delivery)
	await prompt("What word did the other subagent return? Answer with just the word.");
	events6.push(...events);
	const a6 = lastAssistant();
	check("6 next: slow result arrives later", /SLOW/.test(a6), a6.slice(0, 80));
	const slowDeliveries = events6
		.filter(
			(e) =>
				(e.type === "tool_execution_end" && e.toolName === "wait_agents") ||
				(e.type === "message_end" && e.message?.customType === "subagent-result"),
		)
		.map((e) => text(e.result ?? e.message))
		.filter((t) => t.includes(`[${slowId}]`));
	check("6 next: slow result delivered exactly once", slowDeliveries.length === 1, `${slowDeliveries.length} deliveries`);

	// 7) wait_agents with ids still waits for all of them
	await prompt(
		"Use spawn_agent twice in the same turn: first task 'Reply with exactly the word ECHO and nothing else.', " +
			"second task 'Run the bash command `sleep 20`, then reply with exactly the word FOXTROT and nothing else.'. " +
			"Then call wait_agents once with both ids and repeat both words it returned.",
	);
	const waitRes7 = events
		.filter((e) => e.type === "tool_execution_end" && e.toolName === "wait_agents")
		.map((e) => text(e.result))
		.join("\n");
	const id7a = spawnId("ECHO");
	const id7b = spawnId("FOXTROT");
	check(
		"7 ids: one wait returns both",
		waitRes7.includes(`[${id7a}]`) && waitRes7.includes(`[${id7b}]`) && /ECHO/.test(waitRes7) && /FOXTROT/.test(waitRes7) && !waitRes7.includes("Still running:"),
		waitRes7.slice(0, 160),
	);
} catch (e) {
	check("run completed", false, String(e));
} finally {
	pi.kill();
	fs.rmSync(tmp, { recursive: true, force: true });
	const failed = results.filter((r) => !r.ok).length;
	fs.writeFileSync(logFile.replace(/\.jsonl$/, ".summary.json"), JSON.stringify({ model, results }, null, 2));
	console.log(`\n${results.length - failed}/${results.length} passed`);
	process.exit(failed ? 1 : 0);
}
