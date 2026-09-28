# pi-simple-subagent

A from-scratch subagent extension for the [pi coding agent](https://github.com/earendil-works/pi).
**Status: v0.1 prototype, E2E-tested.** See `docs/STATUS.md`.

## Usage (for the agent)

```
spawn_agent({ task, agent? })   start in background, returns id immediately
wait_agents({ ids? })           block until they finish (only when you can't continue without them)
```

Results arrive automatically: slipped into the current run if the main agent is busy,
or held for your next message if it's idle.

## Install / config

```jsonc
// ~/.pi/agent/settings.json
"packages": ["/home/karahanf/projects/pi-simple-subagent"],
// optional: pin a subagent model (otherwise the main session's current model is used)
"simpleSubagent": { "model": "provider/id", "thinking": "medium" }
```

A per-agent `model:` in `~/.pi/agent/agents/<name>.md` frontmatter wins over both.

## Why this exists

We currently use `mjakl/pi-subagent` (forked to `Fatih0234/pi-subagent`, PR mjakl/pi-subagent#22).
It works, but it caused real problems in day-to-day use:

1. **The LLM was invited to pick a model.** The tool schema exposes an optional `model`
   field and the tool description showed `"model": "anthropic/claude-sonnet-4"` as an example.
   The main agent copied that, guessed provider/model names, and retried the same
   wrong guess several times. It failed only because no Anthropic key was configured.
   If the key *had* existed, it would have silently run an old or expensive model the
   user never chose. **Model choice is a cost decision and belongs to the user, not the LLM.**
2. **Too many knobs.** `calls[]`, `session` handles, session locks, `initialContext`,
   two different timeouts, `thinking`, `cwd`, `model`… Every optional field is another
   thing the agent can get wrong, and every word of the description costs tokens every turn.
3. **Only blocking.** The main agent must wait until every subagent finishes. The user
   wants to "multiply" themselves: start work in parallel **in the background**, keep going
   in the main thread, and get the results delivered automatically when they're ready.
4. We already had to patch the prompt once (PR #22). A second round of issues showed
   the design itself needs to change, not just the wording.

## What we want (in the user's words, condensed)

> A simple subagent extension that's easy for the agent to use, smooth, fast, doesn't
> have any problems, and isn't confusing for it. Model, state, all design choices and
> the architecture should reflect this.

- **Simple for the agent**: minimal schema, obvious usage, no way to pick a model.
- **Simple for humans**: small codebase you can read in one sitting.
- **Parallel by default**: fan out several independent tasks at once.
- **Background agents**: spawn → main agent keeps working → result arrives as a message.
- **Predictable model**: explicit user config wins; otherwise the **main session's current model**.

## Explicit non-goals

- Worktrees, isolated servers, or environment setup. The user asks the agent to do those
  separately; they aren't a subagent feature.
- Terminal panes (tmux/cmux/zellij), interactive child sessions.
- Chains, workflows, DAGs, trees, verifier fan-outs, missions, schedules.
- Named or persistent sessions, forking parent context (maybe later, only if a real need shows up).
- Letting the LLM pick models or thinking levels.
- Deep recursion (subagents spawning subagents).

## Layout

| Path | Purpose |
|---|---|
| `README.md` | Motivation and goals (this file) |
| `AGENTS.md` | Instructions for coding agents working in this repo |
| `docs/DESIGN.md` | Proposed design and open questions |
| `docs/DECISIONS.md` | Decision log (append-only) |
| `docs/STATUS.md` | Where we are / what's next (keep it current) |
| `resources/ANALYSIS.md` | Comparison of 14 existing pi subagent extensions |
| `resources/repos.txt` | The reference repos and why each one is here |
| `resources/fetch.sh` | Re-clones the references into `resources/repos/` (gitignored) |
| `index.ts`, `runner.ts`, `model.ts` | The extension |
| `test/`, `e2e/run.mjs` | Unit tests (model choice) and the real-pi E2E driver |
