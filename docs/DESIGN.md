# Design (draft, v0)

Guiding test for every decision: **could a model use this correctly on the first try,
from the tool schema alone, without guessing anything?**

## 1. Model resolution (decided)

Order, first match wins:

1. `model` in the agent definition's frontmatter (user-authored file)
2. the extension's default in `settings.json` (user-authored)
3. **the main session's current model** (`ctx.model`, read at spawn time, not cached),
   plus the main session's current thinking level

Rules:
- The tool schema has **no `model` and no `thinking` parameter**, and the tool description
  never mentions a model name. The LLM can't pick a model, so it can't pick a wrong one.
- If a configured model can't be resolved, **fail loudly** with a clear error.
  Never silently fall back to another model. (tintinweb and yldgio fall back silently;
  we don't.)
- The result says which model actually ran, so cost stays visible.

Prior art: the official pi example and edxeth inherit `ctx.model`; AlexParamonov keeps
`model` out of the schema entirely.

## 2. Background execution (feasible, confirmed)

Pi lets an extension inject a message into the main conversation at any time:

```ts
pi.sendMessage(
  { customType: "subagent-result", content, display: true, details },
  { triggerTurn: true, deliverAs: parentIdle ? "followUp" : "steer" },
);
```

- Parent **idle** → `followUp` + `triggerTurn` wakes the main agent with the result.
- Parent **busy** → `steer` delivers it at the next safe point in the current run.
- 8 of the 14 reference repos do some form of this (tintinweb, williamcr01, AlexParamonov,
  HazAT, edxeth, nicobailon, …). Polling-only designs (yldgio, AgwaB) make the LLM waste turns.

Caveats to handle:
- Every delivery can trigger a model turn, which costs money. Batch results that finish close together.
- Don't deliver twice if the agent explicitly waited for or fetched a result (tintinweb holds the
  nudge for about 200 ms so a pending fetch can cancel it).
- Kill running children on `session_shutdown`. v1 doesn't need to survive a Pi restart.
- The LLM tends to poll or make up results. The prompt must say: "results arrive automatically;
  don't poll or sleep; keep working on other things or end your turn."

## 3. Tool surface (open — pick one)

**Option A — one tool, blocking by default** (smallest change from today)
```
subagent({ task, agent?, background? })
```
- Parallel = several `subagent` calls in the same turn (pi runs them concurrently).
- `background: true` returns an id immediately; the result arrives later as a message.
- Needs a way to wait: probably none in v1 (just end the turn and let delivery wake you).

**Option B — background-first, two tools**
```
spawn_agent({ task, agent? })   -> returns id immediately, always background
wait_agents({ ids? })           -> blocks until the given (or all) agents finish
```
- A single mental model: everything runs in the background.
- "Blocking" = spawn N, then `wait_agents`. Parallel fan-out comes for free.
- `wait_agents` also covers the case where the main agent has nothing else to do.

Either way, maybe add `stop_agent({ id })` later if needed. No action enums, no nested arrays.

Draft recommendation: **B**. It matches the "multiply myself" workflow and has fewer
"which mode?" decisions per call. To discuss.

## 4. Process model (open)

| | Separate `pi --mode json -p --no-session` process | In-process `createAgentSession` |
|---|---|---|
| Isolation | a crash or leak can't hurt the main session | shares the process |
| Startup | ~pi boot time per child | near-instant |
| Kill | `SIGTERM`, simple | abort signal |
| Config/extensions | inherits user config naturally | must build a resource loader by hand |
| Prior art | official example, most "minimal" repos | tintinweb, AlexParamonov, yldgio |

Draft recommendation: subprocess for v1 (simple, robust, and the official example shows how);
measure startup time before deciding.

## 5. Agent definitions (open)

- Reuse the existing `~/.pi/agent/agents/*.md` format (`name`, `description`, `tools`, `model`)
  so the current scout/worker/reviewer/planner files keep working.
- `agent` optional? If omitted, run a general-purpose child with the parent's tools.
- Project-local agents (`.pi/agents`): later, and only with trust confirmation.

## 6. Recursion guard (decided)

Children don't get the subagent tools (env guard, e.g. `PI_SIMPLE_SUBAGENT_CHILD=1` →
the extension registers nothing). No depth levels or stacks.

## 7. Output

- Return the child's final assistant text, truncated with a pointer to a full-output file when large.
- Include a compact status line: agent, model, duration, tokens/cost if available.
- Report token usage on the tool result so session totals stay accurate.

## Open questions for the user

1. Tool surface: A or B?
2. Should `agent` be optional (general-purpose child), or always required?
3. Subprocess vs in-process: OK to start with subprocess?
4. Should background results wake the main agent automatically (`triggerTurn`), or only
   queue for the next turn? Waking costs a turn but is what "background" feels like.
5. Concurrency cap default (4?) — per session.
6. Settings key name and location for the default model.
