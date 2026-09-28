/**
 * pi-simple-subagent — background subagents for pi.
 *
 *   spawn_agent({ task, agent?, cwd? })  start a child pi process, return its id immediately
 *   wait_agents({ ids? })          return the next finished results (or all of the given ids)
 *
 * Results that nobody waits for are delivered automatically:
 *   main agent busy -> slipped into the current run (deliverAs "steer")
 *   main agent idle -> held for the user's next message (deliverAs "nextTurn") + UI notice
 *
 * Design notes: README.md, docs/DESIGN.md, docs/DECISIONS.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { chooseModel } from "./model.ts";
import { CHILD_ENV, type ChildHandle, type ChildResult, runChild } from "./runner.ts";

const MAX_RUNNING = 8;
const MAX_RESULT_CHARS = 30_000;
const RESULTS_DIR = path.join(getAgentDir(), "simple-subagent", "results");

const CHILD_PREAMBLE = `You are a subagent started by another agent. You cannot ask it questions.
Work autonomously on the task. Your final message is returned to that agent verbatim,
so make it self-contained: what you found or did, key file paths, and anything left open.`;

// ---------- agent definitions (~/.pi/agent/agents/*.md) ----------

interface AgentDef {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	prompt: string;
}

function loadAgents(): AgentDef[] {
	const dir = path.join(getAgentDir(), "agents");
	let files: string[] = [];
	try {
		files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
	} catch {
		return [];
	}
	const agents: AgentDef[] = [];
	for (const f of files) {
		try {
			const { frontmatter: fm, body } = parseFrontmatter<Record<string, unknown>>(
				fs.readFileSync(path.join(dir, f), "utf-8"),
			);
			if (typeof fm.name !== "string" || typeof fm.description !== "string") continue;
			const rawTools = Array.isArray(fm.tools) ? fm.tools : typeof fm.tools === "string" ? fm.tools.split(",") : [];
			const tools = rawTools.map((t) => String(t).trim()).filter(Boolean);
			agents.push({
				name: fm.name,
				description: fm.description,
				tools: tools.length ? tools : undefined,
				model: typeof fm.model === "string" ? fm.model : undefined,
				prompt: body,
			});
		} catch {
			// one broken file must not hide the others
		}
	}
	return agents;
}

function readSettings(): { model?: string; thinking?: string } {
	try {
		const s = JSON.parse(fs.readFileSync(path.join(getAgentDir(), "settings.json"), "utf-8"));
		const c = s?.simpleSubagent ?? {};
		return {
			model: typeof c.model === "string" ? c.model : undefined,
			thinking: typeof c.thinking === "string" ? c.thinking : undefined,
		};
	} catch {
		return {};
	}
}

// ---------- run bookkeeping ----------

type Status = "queued" | "running" | "done" | "failed" | "stopped";

interface Run {
	id: string;
	agent: string; // "general" when none given
	task: string;
	cwd?: string; // set only when the caller passed cwd (resolved)
	model: string;
	status: Status;
	startedAt?: number;
	endedAt?: number;
	result?: ChildResult;
	resultFile?: string;
	delivered: boolean;
	waiters: number;
	child?: ChildHandle;
	start: () => void;
	finished: Promise<void>;
	markFinished: () => void;
}

const isFinished = (r: Run) => r.status === "done" || r.status === "failed" || r.status === "stopped";

function fmtDuration(ms: number): string {
	const s = Math.round(ms / 1000);
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

function formatResult(r: Run): string {
	const res = r.result;
	const took = r.startedAt && r.endedAt ? fmtDuration(r.endedAt - r.startedAt) : "-";
	const cost = res?.cost ? `, $${res.cost.toFixed(4)}` : "";
	const header = `[${r.id}] ${r.status} — agent ${r.agent}, model ${res?.model ?? r.model}${r.cwd ? `, cwd ${r.cwd}` : ""}, ${took}, ${res?.turns ?? 0} turns${cost}`;
	let body = r.status === "stopped" ? "(stopped before finishing)" : (res?.output ?? "");
	if (body.length > MAX_RESULT_CHARS) {
		body = `${body.slice(0, MAX_RESULT_CHARS)}\n\n[truncated — full output: ${r.resultFile}]`;
	}
	return `${header}\n\n${body}`;
}

// ---------- extension ----------

export default function (pi: ExtensionAPI) {
	if (process.env[CHILD_ENV]) return; // children never get subagent tools

	const runs = new Map<string, Run>();
	const counters = new Map<string, number>();
	let ctx: ExtensionContext | undefined; // latest live context, refreshed on every call

	const running = () => [...runs.values()].filter((r) => r.status === "running").length;

	const updateStatus = () => {
		if (!ctx?.hasUI) return;
		const active = [...runs.values()].filter((r) => r.status === "running" || r.status === "queued");
		ctx.ui.setStatus("simple-subagent", active.length ? `⧗ ${active.map((r) => r.id).join(" ")}` : undefined);
	};

	const pump = () => {
		for (const r of runs.values()) {
			if (running() >= MAX_RUNNING) break;
			if (r.status === "queued") r.start();
		}
		updateStatus();
	};

	// Busy: results are buffered and flushed as ONE message at turn_end, right before pi polls
	// its steering queue. (pi injects one queued steer message per turn by default, so one
	// message per result would cost one extra model call per result.)
	let pendingSteer: Run[] = [];

	const send = (batch: Run[], deliverAs: "steer" | "nextTurn") => {
		batch = batch.filter((r) => !r.delivered);
		if (!batch.length) return;
		batch.forEach((r) => (r.delivered = true));
		pi.sendMessage(
			{
				customType: "subagent-result",
				content: batch.map(formatResult).join("\n\n---\n\n"),
				display: true,
				details: { ids: batch.map((r) => r.id) },
			},
			{ deliverAs },
		);
		if (deliverAs === "nextTurn" && ctx?.hasUI) {
			const ids = batch.map((r) => r.id).join(", ");
			ctx.ui.notify(`${ids} finished — result will be included with your next message`, "info");
		}
	};

	// Safety net: a result buffered in the gap after the run's last turn_end/agent_settled
	// but before pi reports idle would otherwise wait for the *next* run. Poll until idle.
	let idleWatch: ReturnType<typeof setInterval> | undefined;
	const stopIdleWatch = () => {
		if (idleWatch) clearInterval(idleWatch);
		idleWatch = undefined;
	};
	const watchForIdle = () => {
		if (idleWatch) return;
		idleWatch = setInterval(() => {
			if (!pendingSteer.length) stopIdleWatch();
			else if (ctx?.isIdle()) {
				stopIdleWatch();
				flush("nextTurn");
			}
		}, 500);
		idleWatch.unref?.();
	};

	const deliver = (r: Run) => {
		if (r.delivered) return;
		if (ctx?.isIdle() ?? true) send([r], "nextTurn");
		else if (!pendingSteer.includes(r)) {
			pendingSteer.push(r);
			watchForIdle();
		}
	};

	const flush = (deliverAs: "steer" | "nextTurn") => {
		const batch = pendingSteer;
		pendingSteer = [];
		send(batch, deliverAs);
	};

	const onFinish = (r: Run) => {
		r.endedAt = Date.now();
		if (r.result) {
			try {
				fs.mkdirSync(RESULTS_DIR, { recursive: true });
				r.resultFile = path.join(RESULTS_DIR, `${Date.now()}-${r.id}.md`);
				fs.writeFileSync(
					r.resultFile,
					`# ${r.id}${r.cwd ? `\ncwd: ${r.cwd}` : ""}\n\n## Task\n\n${r.task}\n\n## Result\n\n${r.result.output}\n`,
				);
			} catch {
				r.resultFile = undefined;
			}
		}
		r.markFinished();
		if (r.waiters === 0) deliver(r); // a waiting wait_agents call collects it instead
		pump();
	};

	const agentsAtLoad = loadAgents();
	const agentHelp = agentsAtLoad.length
		? `Optional named agent: ${agentsAtLoad.map((a) => `"${a.name}" (${a.description})`).join("; ")}. Omit for a general-purpose agent with the default tools.`
		: "Optional named agent from ~/.pi/agent/agents. Omit for a general-purpose agent.";

	pi.registerTool({
		name: "spawn_agent",
		label: "Spawn agent",
		description:
			"Start a subagent in the background; returns its id immediately. The subagent cannot see this conversation, so put everything it needs (goal, paths, constraints, expected output) in `task`. " +
			`For parallel work, call spawn_agent several times (up to ${MAX_RUNNING} run at once, extra ones queue). ` +
			"Its final answer is delivered to you automatically as a message: do not poll, sleep or guess its result. " +
			"Keep working on other things, or call wait_agents when you cannot continue without the results.",
		promptSnippet: "spawn_agent: run a task in a background subagent (parallel work); results arrive automatically",
		parameters: Type.Object({
			task: Type.String({ description: "Complete, self-contained instructions for the subagent." }),
			agent: Type.Optional(Type.String({ description: agentHelp })),
			cwd: Type.Optional(
				Type.String({
					description:
						"Working directory for the subagent, such as a git worktree you created. Absolute, or relative to your cwd. Defaults to your cwd.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, c) {
			ctx = c;
			const cwd = params.cwd ? path.resolve(c.cwd, params.cwd) : undefined;
			if (cwd && !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
				throw new Error(`cwd ${cwd} is not an existing directory.`);
			}
			const agents = loadAgents();
			const def = params.agent ? agents.find((a) => a.name === params.agent) : undefined;
			if (params.agent && !def) {
				throw new Error(
					`Unknown agent "${params.agent}". Available: ${agents.map((a) => a.name).join(", ") || "none"}. Or omit agent.`,
				);
			}

			const settings = readSettings();
			const choice = chooseModel(
				{
					agentName: def?.name,
					agentModel: def?.model,
					settingsModel: settings.model,
					settingsThinking: settings.thinking,
					sessionModel: c.model ? { provider: c.model.provider, id: c.model.id } : undefined,
					sessionThinking: pi.getThinkingLevel(),
				},
				{
					isUsable: (provider, id) => {
						const m = c.modelRegistry.find(provider, id);
						return !!m && c.modelRegistry.hasConfiguredAuth(m);
					},
				},
			);

			const base = def?.name ?? "agent";
			const n = (counters.get(base) ?? 0) + 1;
			counters.set(base, n);
			const id = `${base}-${n}`;

			let markFinished!: () => void;
			const finished = new Promise<void>((res) => (markFinished = res));
			const run: Run = {
				id,
				agent: def?.name ?? "general",
				task: params.task,
				cwd,
				model: choice.model,
				status: "queued",
				delivered: false,
				waiters: 0,
				finished,
				markFinished,
				start: () => {
					run.status = "running";
					run.startedAt = Date.now();
					const fail = (msg: string) => {
						run.result = { ok: false, output: msg, turns: 0, cost: 0, input: 0, output_tokens: 0, stderr: "" };
						run.status = "failed";
						onFinish(run);
					};
					try {
						run.child = runChild({
							task: params.task,
							cwd: run.cwd ?? c.cwd,
							model: choice.model,
							thinking: choice.thinking,
							tools: def?.tools,
							systemPrompt: [CHILD_PREAMBLE, def?.prompt ?? ""].join("\n\n").trim(),
						});
					} catch (e) {
						// defer so a failure inside pump() cannot re-enter pump() mid-loop
						queueMicrotask(() => fail(`could not start subagent: ${e instanceof Error ? e.message : e}`));
						return;
					}
					run.child.done.then(
						(result) => {
							if (run.status !== "running") return; // stopped meanwhile
							run.result = result;
							run.status = result.ok ? "done" : "failed";
							onFinish(run);
						},
						(e) => run.status === "running" && fail(`subagent crashed: ${e}`),
					);
				},
			};
			runs.set(id, run);
			pump();

			const where = run.status === "queued" ? `queued (${MAX_RUNNING} already running)` : "started";
			return {
				content: [
					{
						type: "text",
						text: `${id} ${where} in background${run.cwd ? ` in ${run.cwd}` : ""} with model ${choice.model} (${choice.source}). Its result will be delivered to you automatically.`,
					},
				],
				details: { id, model: choice.model, source: choice.source, cwd: run.cwd },
			};
		},
	});

	pi.registerTool({
		name: "wait_agents",
		label: "Wait for agents",
		description:
			"Wait for background subagents and return their results. Use only when you cannot continue without them. " +
			"Without ids: returns as soon as at least one subagent whose result you have not received finishes, with every result finished by then; " +
			"the others keep running and arrive automatically, or call wait_agents again. " +
			"With ids: blocks until all of those finish.",
		promptSnippet: "wait_agents: wait for the next background subagent results (or all of specific ids)",
		parameters: Type.Object({
			ids: Type.Optional(
				Type.Array(Type.String(), { description: "Subagent ids from spawn_agent. Blocks until all of them finish." }),
			),
		}),
		async execute(_id, params, signal, onUpdate, c) {
			ctx = c;
			let targets: Run[];
			if (params.ids?.length) {
				const unknown = params.ids.filter((i) => !runs.has(i));
				if (unknown.length) {
					throw new Error(`Unknown id(s): ${unknown.join(", ")}. Known: ${[...runs.keys()].join(", ") || "none"}.`);
				}
				targets = params.ids.map((i) => runs.get(i)!);
			} else {
				targets = [...runs.values()].filter((r) => !r.delivered);
			}
			if (!targets.length) {
				return { content: [{ type: "text", text: "No subagents to wait for." }], details: undefined };
			}

			targets.forEach((r) => r.waiters++);
			let ended = false; // no progress updates after this tool call has returned or thrown
			const progress = () =>
				!ended &&
				onUpdate?.({
					content: [{ type: "text", text: `${targets.filter(isFinished).length}/${targets.length} finished` }],
					details: undefined,
				});
			targets.forEach((r) => r.finished.then(progress));
			progress();

			let aborted = false;
			try {
				await new Promise<void>((resolve) => {
					// no ids: return as soon as the next target finishes; ids: wait for all of them
					const finishes = targets.map((r) => r.finished);
					(params.ids?.length ? Promise.all(finishes) : Promise.race(finishes)).then(() => resolve());
					const onAbort = () => ((aborted = true), resolve());
					if (signal?.aborted) onAbort();
					else signal?.addEventListener("abort", onAbort, { once: true });
				});
			} finally {
				ended = true;
				targets.forEach((r) => r.waiters--);
			}

			if (aborted) {
				// hand finished-but-unseen results to the normal delivery path; keep children running
				targets.filter((r) => isFinished(r) && r.waiters === 0).forEach(deliver);
				throw new Error("wait_agents aborted; subagents keep running and deliver their results automatically.");
			}

			const parts = targets.filter(isFinished).map((r) => {
				if (r.delivered) return `[${r.id}] ${r.status} — result was already delivered to you earlier.`;
				r.delivered = true;
				return formatResult(r);
			});
			const stillRunning = targets.filter((r) => !isFinished(r));
			if (stillRunning.length) {
				parts.push(
					`Still running: ${stillRunning.map((r) => r.id).join(", ")}. Their results are delivered to you automatically while you keep working; call wait_agents again when you run out of work.`,
				);
			}
			return { content: [{ type: "text", text: parts.join("\n\n---\n\n") }], details: undefined };
		},
	});

	pi.on("session_start", (_e, c) => {
		ctx = c;
	});

	pi.on("turn_end", () => flush("steer"));
	// A result that finished after the last turn_end of a run: hold it for the next message.
	pi.on("agent_settled", () => flush("nextTurn"));

	pi.on("session_shutdown", () => {
		for (const r of runs.values()) {
			if (r.status === "running" || r.status === "queued") {
				r.status = "stopped";
				r.child?.kill();
				r.markFinished();
			}
		}
		runs.clear();
		pendingSteer = [];
		stopIdleWatch();
		ctx = undefined;
	});
}
