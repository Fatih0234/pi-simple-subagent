/**
 * Runs one child `pi` process in JSON print mode and collects its final answer.
 * Spawn/argv handling follows the official pi subagent example.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Set in the child's environment; the extension registers nothing when it sees it. */
export const CHILD_ENV = "PI_SIMPLE_SUBAGENT_CHILD";

export interface ChildSpec {
	task: string;
	cwd: string;
	model: string;
	thinking?: string;
	tools?: string[];
	systemPrompt: string;
}

export interface ChildResult {
	ok: boolean;
	output: string; // final assistant text (or error text)
	model?: string; // what actually answered, as reported by the child
	turns: number;
	cost: number;
	input: number;
	output_tokens: number;
	stderr: string;
}

export interface ChildHandle {
	done: Promise<ChildResult>;
	kill(): void;
}

const MAX_ARG = 100_000; // stay well below Linux MAX_ARG_STRLEN (128 KiB)

function piInvocation(args: string[]): { command: string; args: string[] } {
	const script = process.argv[1];
	if (script && !script.startsWith("/$bunfs/root/") && fs.existsSync(script)) {
		return { command: process.execPath, args: [script, ...args] };
	}
	const exe = path.basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(exe)) return { command: process.execPath, args };
	return { command: "pi", args };
}

export function runChild(spec: ChildSpec, onProgress?: (turns: number) => void): ChildHandle {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-simple-subagent-"));
	const promptFile = path.join(tmp, "system.md");
	fs.writeFileSync(promptFile, spec.systemPrompt, { mode: 0o600 });

	let task = spec.task;
	if (task.length > MAX_ARG) {
		const taskFile = path.join(tmp, "task.md");
		fs.writeFileSync(taskFile, task, { mode: 0o600 });
		task = `Your task is in ${taskFile}. Read it fully, then do it.`;
	}

	const args = ["--mode", "json", "-p", "--no-session", "--model", spec.model];
	if (spec.thinking) args.push("--thinking", spec.thinking);
	if (spec.tools?.length) args.push("--tools", spec.tools.join(","));
	args.push("--append-system-prompt", promptFile, task);

	const inv = piInvocation(args);
	const proc = spawn(inv.command, inv.args, {
		cwd: spec.cwd,
		env: { ...process.env, [CHILD_ENV]: "1" },
		stdio: ["ignore", "pipe", "pipe"],
	});

	const r: ChildResult = { ok: false, output: "", turns: 0, cost: 0, input: 0, output_tokens: 0, stderr: "" };
	let lastText = "";
	let lastError = "";
	let buf = "";

	const onLine = (line: string) => {
		if (!line.trim()) return;
		let ev: any;
		try {
			ev = JSON.parse(line);
		} catch {
			return;
		}
		if (ev.type !== "message_end" || ev.message?.role !== "assistant") return;
		const m = ev.message;
		r.turns++;
		r.input += m.usage?.input ?? 0;
		r.output_tokens += m.usage?.output ?? 0;
		r.cost += m.usage?.cost?.total ?? 0;
		if (m.provider && m.model) r.model = `${m.provider}/${m.model}`;
		const text = (m.content ?? [])
			.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("\n")
			.trim();
		if (text) lastText = text;
		if (m.errorMessage) lastError = m.errorMessage;
		onProgress?.(r.turns);
	};

	const done = new Promise<ChildResult>((resolve) => {
		proc.stdout.on("data", (d) => {
			buf += d.toString();
			const lines = buf.split("\n");
			buf = lines.pop() ?? "";
			lines.forEach(onLine);
		});
		proc.stderr.on("data", (d) => {
			r.stderr = (r.stderr + d.toString()).slice(-4000);
		});
		const finish = (code: number | null) => {
			if (buf) onLine(buf);
			fs.rmSync(tmp, { recursive: true, force: true });
			r.ok = code === 0 && !lastError && !!lastText;
			r.output = r.ok
				? lastText
				: [lastError || `child exited with code ${code}`, lastText, r.stderr.trim()].filter(Boolean).join("\n\n");
			resolve(r);
		};
		proc.on("close", finish);
		proc.on("error", (e) => {
			r.stderr += String(e);
			finish(null);
		});
	});

	return {
		done,
		kill() {
			if (proc.exitCode !== null) return;
			proc.kill("SIGTERM");
			setTimeout(() => proc.exitCode === null && proc.kill("SIGKILL"), 3000).unref();
		},
	};
}
