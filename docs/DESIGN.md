# Design (v0.1, as built)

Guiding test for every decision: **could a model use this correctly on the first try,
from the tool schema alone, without guessing anything?**

## Tools

```
spawn_agent({ task, agent? })  -> "agent-1 started in background with model X (session)…"
wait_agents({ ids? })          -> blocks; returns results (omit ids = all not yet received)
```

- Everything runs in the background. Parallel work = several `spawn_agent` calls.
- `agent` is optional. Named agents come from `~/.pi/agent/agents/*.md` (`name`, `description`,
  `tools`, `model`, and the body is appended to the system prompt). Omitted → general-purpose
  child with pi's default tools.
- Up to 8 children run at once; extra ones queue and start when a slot frees.
- No `model`, `thinking`, `cwd`, session or timeout parameters.

## Model resolution

1. `model` in the agent frontmatter
2. `simpleSubagent.model` (and optional `simpleSubagent.thinking`) in `~/.pi/agent/settings.json`
3. the main session's **current** model + thinking level (read at spawn time)

A configured model must be `provider/id[:thinking]`, exist in the registry and have credentials;
otherwise `spawn_agent` fails with a clear error. It never falls back to another model.
Every result header shows the model that actually answered. Code: `model.ts`, tests: `test/model.test.ts`.

## Delivery of results

| Main agent is… | What happens |
|---|---|
| busy | results are buffered and flushed as **one** combined message at `turn_end` (`deliverAs: "steer"`), so the next model request sees them |
| idle | not woken. Held with `deliverAs: "nextTurn"` → included with the user's next message; UI notice shown |
| waiting in `wait_agents` | the wait returns them; no separate message (no duplicates) |

Why batch: pi's default steering mode injects one queued message per turn, so one message
per result cost an extra model call per result (seen in the first E2E run).

## Process model

Each child is a separate `pi --mode json -p --no-session --model … [--thinking …] [--tools …]
--append-system-prompt <file> <task>` process with `PI_SIMPLE_SUBAGENT_CHILD=1` in its env.
With that variable set, the extension registers nothing, so children can't spawn children.
Measured: a trivial child takes about 3–4 s end-to-end, including the model call.
Children are killed on `session_shutdown`.

## Output

- Result = the child's final assistant text, with a header: id, status, agent, model, duration, turns, cost.
- Model-facing text is capped at 30k chars; the full output is always saved to
  `~/.pi/agent/simple-subagent/results/<ts>-<id>.md` and the path is given when truncated.

## Known gaps / later

- No `stop_agent` tool (Esc during `wait_agents` stops waiting; children keep running).
- No project-local agents (`.pi/agents`).
- Background child usage isn't added to the main session's token/cost totals (it's shown in the result header).
- No custom TUI rendering; results render as plain custom messages.
- Not type-checked with `tsc` (pi packages can't be installed from npm here); verified by E2E.
