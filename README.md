# pi-simple-subagent

**Background subagents for the [pi coding agent](https://github.com/earendil-works/pi): two tools, no model guessing, no polling.**

```
spawn_agent({ task, agent? })   → starts in the background, returns an id immediately
wait_agents({ ids? })           → blocks only when you actually need the results
```

Your main agent hands off work, **keeps working**, and results show up in the conversation
when they're ready. About 600 lines of TypeScript in 3 files, with no runtime dependencies.

```bash
pi install git:github.com/Fatih0234/pi-simple-subagent
```

---

## Why another subagent extension?

We studied [14 existing pi subagent extensions](resources/ANALYSIS.md) and kept running into the same problems in daily use:

- **The LLM picks the model.** Many tools expose a `model` parameter, some with example model names in
  the description. Agents copy the example, guess provider names, and retry. When it "works",
  you're paying for an old or expensive model you never chose.
- **Blocking.** The main agent sits and waits until every subagent is done.
- **Polling.** "Background" modes where the agent has to call `status`/`collect` over and over, burning turns.
- **Too many knobs.** Schemas with 10–80 optional fields (sessions, chains, worktrees, timeouts, modes…).
  Every field costs tokens on every turn and is one more thing the agent can get wrong.

pi-simple-subagent does one thing: **multiply your agent**. It fans work out in parallel, in the background, and does it predictably.

## What makes it different

| | pi-simple-subagent |
|---|---|
| 🧠 **You choose the model, the LLM doesn't** | There's no `model` or `thinking` parameter. Subagents use **your current session model** (switch models in pi and subagents follow), or the model you pin in settings. A pinned model that's missing or has no credentials is an error. It **never silently falls back** to another model. |
| 🚀 **Background by default** | `spawn_agent` returns instantly. Start 5 tasks, keep editing code, and results arrive automatically. |
| 🔕 **No polling, no surprise turns** | Main agent busy → results are slipped into its current run. Main agent idle → it is **not** woken up (no unrequested spend). Results wait for your next message, with a UI notice. |
| 💸 **Cost-aware delivery** | Results that finish while the agent is busy go in as **one** message, not one per result. Pi takes in one queued message per turn, so batching saves a model call per extra result. Every result shows model, duration, turns and cost. |
| 🧩 **Tiny schema** | 2 tools, 3 parameters in total. Easy for any model to use on the first try. |
| 🧱 **Process isolation** | Each subagent is a separate `pi` process. A crash can't take down your session. Children can't spawn children. |
| 📖 **Readable** | ~600 lines, 3 source files. Read the whole thing in 15 minutes. |
| ✅ **Tested against real pi** | An E2E driver runs a real pi in RPC mode and checks each delivery path, batching, and which model ran. |

### Compared with other approaches

| | Blocking subagent tools | Orchestration frameworks | **pi-simple-subagent** |
|---|---|---|---|
| Main agent keeps working | ❌ | ✅ | ✅ |
| Results arrive without polling | n/a | varies | ✅ |
| LLM can pick or guess models | often | often | **never** |
| Silent model fallback | sometimes | sometimes | **never** |
| Tool parameters | 2–15 | 15–80+ | **3** |
| Code size | 0.2k–4k lines | 14k–105k lines | **~0.6k lines** |
| Worktrees / tmux / workflows | – | ✅ | intentionally no |

## Usage

Just ask pi to parallelize:

> "Spawn a scout to map the auth module, a reviewer to check `api/` for injection issues,
> and a general agent to update the changelog. Meanwhile, fix the failing test."

What the agent does:

```text
spawn_agent({ agent: "scout",    task: "Map src/auth: entry points, session handling, ..." })
  → scout-1 started in background with model github-copilot/gpt-6-luna (settings)
spawn_agent({ agent: "reviewer", task: "Review api/ for injection issues. Report file:line ..." })
  → reviewer-1 started ...
spawn_agent({ task: "Update CHANGELOG.md with the changes in the last 5 commits ..." })
  → agent-1 started ...
bash("npm test") ... edit(...) ...        ← main agent keeps working
                                          ← results slip in as they finish:
[scout-1] done — agent scout, model github-copilot/gpt-6-luna, 6s, 2 turns, $0.0021
...
```

If the agent can't go on without results, it calls `wait_agents()`.

### Named agents (optional)

Uses the common pi agent format in `~/.pi/agent/agents/*.md`:

```markdown
---
name: scout
description: Fast codebase recon that returns compressed context
tools: read, grep, find, ls, bash
model: github-copilot/gpt-6-luna   # optional, overrides everything else
---
You are a scout. Investigate quickly and return a compact summary...
```

Leave out `agent` to get a general-purpose subagent with pi's default tools.

## Model selection

First match wins:

1. `model:` in the agent's frontmatter
2. `simpleSubagent.model` in `~/.pi/agent/settings.json`
3. **the main session's current model and thinking level** (the default, no config needed)

```jsonc
// ~/.pi/agent/settings.json  (optional)
"simpleSubagent": { "model": "github-copilot/gpt-6-luna", "thinking": "high" }
```

Configured models must be `provider/id` (optionally `:thinking`); list them with `pi --list-models`.
Fuzzy names like `"sonnet"` are rejected, so pi can't match them to a model you didn't mean.

## How results are delivered

| Main agent is… | What happens |
|---|---|
| busy (streaming or running tools) | results are buffered and injected as one message at the end of the turn, so the next model request sees them |
| idle (waiting for you) | not woken. Results are attached to your next message, and a notice is shown |
| blocked in `wait_agents` | `wait_agents` returns them; no duplicate message |

Up to 8 subagents run at once; more queue automatically. Full outputs are saved to
`~/.pi/agent/simple-subagent/results/`, and long results are truncated with a pointer to that file.
Running subagents are stopped when the pi session ends.

## Non-goals

These are deliberate. Your agent can already do them with bash, or other extensions do them well:

- git worktrees, sandboxes, dev servers
- tmux/terminal panes, interactive child sessions
- chains, workflows, DAGs, verifier fan-out
- persistent or resumable subagent sessions
- recursive subagents

## Install

```bash
pi install git:github.com/Fatih0234/pi-simple-subagent
# or try it for one session:
pi -e git:github.com/Fatih0234/pi-simple-subagent
```

Tip: uninstall other subagent extensions so the agent doesn't see two competing sets of tools.

## Development

```bash
npm test               # model-selection unit tests (node --test, no install needed)
node e2e/run.mjs       # real pi in RPC mode: busy/idle/wait delivery, batching, model choice
                       # (makes a few tiny model calls, writes logs to e2e/artifacts/)
```

| Path | |
|---|---|
| `index.ts` | tools, run queue, delivery |
| `runner.ts` | child `pi` process |
| `model.ts` | model selection (pure) |
| `docs/DESIGN.md` · `docs/DECISIONS.md` | design and decision log |
| `resources/ANALYSIS.md` | comparison of 14 existing pi subagent extensions |

## License

MIT
