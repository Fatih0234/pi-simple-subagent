#!/usr/bin/env node
// E2E: drive a real pi (RPC mode) with only this extension loaded and check the three
// delivery paths plus model inheritance. Writes the full event log to e2e/artifacts/.
//
//   node e2e/run.mjs [provider/model]     (default: $PI_PROVIDER/$PI_MODEL of the calling session)
//
// Uses real model calls (tiny prompts). Children inherit the parent's model, which is
// deliberately different from settings.json defaultModel so inheritance is observable.

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const model = process.argv[2] ?? `${process.env.PI_PROVIDER}/${process.env.PI_MODEL}`;
if (model.includes("undefined")) throw new Error("pass provider/model");
const artifacts = path.join(root, "e2e", "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const logFile = path.join(artifacts, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
const log = fs.createWriteStream(logFile);

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
	console.log(`parent model: ${model}\nlog: ${path.relative(root, logFile)}\n`);

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
	check("1 model inherited from parent session", headers.length === 2 && headers.every((h) => h.includes(`model ${model}`)), headers[0]);

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
	await prompt(
		"Use spawn_agent with agent 'scout' and task 'Reply with exactly the word DELTA and nothing else.', then call wait_agents and tell me what it returned.",
	);
	const a3 = lastAssistant();
	check("3 wait: wait_agents used", tools("wait_agents").length >= 1);
	check("3 wait: answer has DELTA", /DELTA/.test(a3), a3.slice(0, 80));
	check("3 wait: no duplicate result message", resultMsgs().length === 0, `${resultMsgs().length} result messages`);
} catch (e) {
	check("run completed", false, String(e));
} finally {
	pi.kill();
	const failed = results.filter((r) => !r.ok).length;
	fs.writeFileSync(logFile.replace(/\.jsonl$/, ".summary.json"), JSON.stringify({ model, results }, null, 2));
	console.log(`\n${results.length - failed}/${results.length} passed`);
	process.exit(failed ? 1 : 0);
}
