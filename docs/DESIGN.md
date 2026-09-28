# Design (v0.2, as built)

Guiding test for every decision: **could a model use this correctly on the first try,
from the tool schema alone, without guessing anything?**

## Tools

```
spawn_agent({ task, agent?, cwd? })  -> "agent-1 started in background with model X (session)…"
wait_agents({ ids? })          -> no ids: returns as soon as the next subagent finishes, with
                                  every result finished by then plus a "Still running:" note;
                                  with ids: blocks until all of them finish
```

- Everything runs in the background. Parallel work = several `spawn_agent` calls.
- `agent` is optional. Named agents come from `~/.pi/agent/agents/*.md` (`name`, `description`,
  `tools`, `model`, and the body is appended to the system prompt). Omitted → general-purpose
  child with pi's default tools.
- Up to 8 children run at once; extra ones queue and start when a slot frees.
- No `model`, `thinking`, session or timeout parameters.

## Model resolution

1. `model` in the agent frontmatter
2. `simpleSubagent.model` (and optional `simpleSubagent.thinking`) in `~/.pi/agent/settings.json`
3. the main session's **current** model + thinking level (read at spawn time)

A configured model must be `provider/id[:thinking]`, exist in the registry and have credentials;
otherwise `spawn_agent` fails with a clear error. It never falls back to another model.
Every result header shows the model that actually answered. Code: `model.ts`, tests: `test/model.test.ts`.

## cwd

`spawn_agent` takes an optional `cwd` (absolute, or relative to the caller's cwd), validated
to be an existing directory before anything else happens. The child `pi` process runs with
that cwd. pi derives the system prompt `<cwd>`, relative path resolution in read/edit/write,
each bash call's directory, AGENTS.md discovery, and project config/trust from the process
cwd. A worker told to fix a git worktree but left in the main checkout edits the wrong
checkout on the first relative path, so the cwd must follow the worktree. The spawn reply
and the result header show the cwd when it was set.

## Skill: parallel-worktrees

`skills/parallel-worktrees` ships in the package and is user-invoked
(`disable-model-invocation`), so it costs no context until the user types
`/skill:parallel-worktrees <tasks>`.

The main agent acts as coordinator: one worktree and `agent/<slug>` branch per task, one
worker spawned per worktree with `cwd`. Task state lives at
`git rev-parse --git-path pi-task.md` inside the worktree's private git directory, not at
`.pi/task-state.md`: a file inside the tree would be swept into commits by `git add -A`
and would make `git worktree remove` refuse. Workers commit only; the coordinator reviews
each diff, pushes and opens PRs itself. The coordinator stays in the main checkout and
addresses worktrees with `git -C <wt>`.

## Delivery of results

| Main agent is… | What happens |
|---|---|
| busy | results are buffered and flushed as **one** combined message at `turn_end` (`deliverAs: "steer"`), so the next model request sees them |
| idle | not woken. Held with `deliverAs: "nextTurn"` → included with the user's next message; UI notice shown |
| waiting in `wait_agents` | the wait returns the finished ones; runs still going are delivered later by the normal paths (no duplicates) |

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
