# Launch copy (drafts)

## Short (X / Bluesky / Discord #showcase)

> Built **pi-simple-subagent**: background subagents for pi in ~600 lines.
>
> • `spawn_agent` returns instantly, so your agent keeps working
> • results arrive automatically, with no polling
> • the LLM can **never** pick the model: it uses your session model or your pinned one, never a silent fallback
> • results that finish together go in as one message, so no extra paid turns
>
> `pi install git:github.com/Fatih0234/pi-simple-subagent`
> https://github.com/Fatih0234/pi-simple-subagent

## Longer (Reddit / HN / blog)

**Title:** I studied 14 pi subagent extensions and wrote a 600-line one that doesn't let the LLM choose the model

My agent was delegating work and filled in the subagent's optional `model` field with a model name it had
copied from the tool description. It retried the same guess a few times. It only failed because I had no key
for that provider. Otherwise I'd have been paying for a model I never chose.

So I looked at 14 existing pi subagent extensions. The recurring issues: LLM-chosen models, blocking tools,
"background" modes that need polling, and schemas with up to ~80 parameters.

pi-simple-subagent is the opposite:
- **2 tools, 3 parameters:** `spawn_agent({ task, agent? })`, `wait_agents({ ids? })`
- **Background by default.** If your agent is busy, results slip into its current run. If it's idle, it isn't
  woken up; results are attached to your next message.
- **Model = your choice.** Agent frontmatter → settings → your live session model. A misconfigured model is an
  error, never a silent swap.
- **Cost-aware.** pi takes in one queued message per turn, so results are batched into one message.
- **Isolated.** Each child is its own `pi` process. There's no recursion.
- **Tested end to end** against real pi in RPC mode.

Intentionally out of scope: worktrees, tmux panes, workflows, persistent sessions.

Repo: https://github.com/Fatih0234/pi-simple-subagent

## Where to post
- pi Discord (showcase / extensions channel)
- r/LocalLLaMA or r/ChatGPTCoding (the "LLM picks your model" story is the hook)
- Hacker News "Show HN" once it's on npm, so install is a single `npm:` line
- pi.dev/packages: automatic after `npm publish` (keyword `pi-package` is already set)

## Nice to have before a big push
- A 20–30 s demo GIF: spawn 3 agents, keep editing, results slip in. Add it to the README and as `pi.image`
  in package.json (the gallery shows it).
- npm publish, so the install becomes `pi install npm:pi-simple-subagent`.
