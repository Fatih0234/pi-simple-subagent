# Reference analysis: existing pi subagent extensions

Collected 2026-09-28 via `gh search repos`. Code is in `resources/repos/<owner>__<repo>/`.
Paths below are relative to that directory. Line numbers are approximate (±2).

## Summary table

| Repo | ~LOC | Tool(s) | Model when unset | LLM may pass model? | Exec | Background + delivery |
|---|---|---|---|---|---|---|
| earendil-works (official example) | 1.2k | `subagent` (single/parallel/chain) | **ctx.model** (+ thinking) | no | `pi --mode json -p --no-session` | no |
| JerryAZR/pi-subagent-lite | 0.2k | `subagent(task, skills?)` | child's pi default | no | `pi --mode json -p` | no |
| amosblomqvist/pi-subagents | 1.0k | `subagent(agent, task, cwd?)` | **hard-coded** sonnet | no | `pi --mode json -p` | no |
| elpapi42/pi-minimal-subagent | 1.1k | `subagent(agent, task)` | settings.json, else child default | no | `pi --mode json -p` | no |
| mjakl/pi-subagent (current) | 3.6k | `subagent(calls[])` | **ctx.model** | **yes** (example invites it) | `pi --mode rpc` | no |
| eggmasonvalue/pi-subagent | 1.5k | `subagent`, `subagent_models` | allowlist default, else child default | **yes, encouraged** (model catalog) | `pi --mode json -p` | no (timeout → resume) |
| yldgio/pi-background-agents | 0.9k | `background_agent(action enum)` | **ctx.model** (captured on first call) | yes | in-process `createAgentSession` | yes, **polling** only |
| williamcr01/pi-subagents | 3.3k | `spawn_agent`, `check_subagents`, `send_to_subagent`, `cancel_subagent` | settings → **ctx.model** | yes | `pi --mode rpc` | yes: followUp at idle + piggyback on `tool_result` |
| HazAT/pi-interactive-subagents | 5.0k | `subagent`, `subagent_resume`, … | child default | yes | interactive pi in tmux/cmux pane | yes: `steer` |
| edxeth/pi-subagents | 25k | `subagent`, `subagent_resume`, `subagent_kill`, … | **ctx.model** (+ thinking) | allowed, but prompt says don't | `pi -p` or mux pane | yes: `steer`/`nextTurn` |
| AlexParamonov/pi-subagents-lite | 14k | `Agent`, `StopAgent`, `AgentStatus` (descriptions are `"."`) | config chain → **ctx.model** | **no** (not in schema) | in-process | yes: followUp if idle, else steer |
| tintinweb/pi-subagents | 21k | `Agent`, `get_subagent_result`, `steer_subagent`, `SubagentWorkflow` | **ctx.model** (silent fallback) | yes, fuzzy ("haiku") | in-process | yes (default): followUp, with nudge hold + batching |
| nicobailon/pi-subagents | 105k | `subagent` (~80 params), `bg_wait`, … | … → **parent model** | yes | detached runner + rpc | yes (default): result files → sendMessage |
| AgwaB/pi-subagent | 17k | `subagent` (huge union, action enum) | child default | yes | json -p / tmux / inline | yes, but **polling** only |

## What to steal

- **ctx.model + thinking inheritance, read at spawn time.** Official `index.ts:~302,486`.
- **Tiny schema.** elpapi42 (`agent`, `task`) and JerryAZR (`task`).
  Parallelism = several tool calls in one turn (amos, elpapi42, JerryAZR say so explicitly).
- **Model not in schema at all.** AlexParamonov. edxeth wording if we ever expose it:
  "Omit unless the user named a concrete model… Never invent or upgrade models."
- **Background delivery.** AlexParamonov `spawn/spawn-coordinator.ts:~206`:
  `deliverAs = parentIdle ? "followUp" : "steer"`, `triggerTurn: true`.
- **Avoid double delivery.** tintinweb `src/index.ts:~446-525`: hold the nudge ~200 ms so an
  explicit fetch can cancel it; batch completions that land close together.
- **Idle-gated delivery + de-dupe receipts.** williamcr01 `index.ts:~180-280`.
- **Prompt wording against polling/fabrication.** HazAT `subagent` description:
  "results are delivered automatically… DO NOT write polling loops… DO NOT fabricate results".
- **Recursion guard.** Env var (JerryAZR `PI_SUBAGENT_LITE_DISABLE`) or `--exclude-tools subagent` (AgwaB).
- **Long task → temp file** instead of a huge argv (JerryAZR, amos).
- **Kill children on `session_shutdown`** (williamcr01).
- **Error lists the available agents** (official, elpapi42).

## What to avoid

- A `model` param and model examples in descriptions (mjakl), model catalogs (eggmason),
  fuzzy model names (tintinweb), hard-coded models (amos).
- Silent fallback to another model (tintinweb, yldgio).
- Polling-only background (yldgio, AgwaB): burns turns.
- Action-enum mega-tools and wide unions (yldgio, AgwaB, nicobailon's ~80 params).
- Caching `ctx` values across calls (yldgio bug).
- `"."` descriptions (AlexParamonov): the LLM has to guess.
- Multiplexers, worktrees, workflows, chains, verifiers, missions (HazAT, edxeth, nicobailon, AgwaB).

## Best files to read first

1. `earendil-works__pi-official-subagent/index.ts`: clean baseline, spawn args, ctx.model.
2. `elpapi42__pi-minimal-subagent/src/index.ts`, `src/runner.ts`: the minimal schema.
3. `AlexParamonov__pi-subagents-lite/src/spawn/spawn-coordinator.ts`: idle-aware delivery.
4. `williamcr01__pi-subagents/index.ts:180-280`: careful async delivery.
5. `tintinweb__pi-subagents/src/index.ts:440-525`: nudge hold + grouped completion.
