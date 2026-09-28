# Motivation (project history)

Why this project was started. The original internal notes, kept as project state.

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

