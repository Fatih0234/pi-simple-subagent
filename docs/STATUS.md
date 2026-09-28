# Status

_Last updated: 2026-09-28_

## Where we are
- **v0.1 prototype works.** `index.ts` (tools + delivery), `runner.ts` (child process), `model.ts` (model choice).
- Tests:
  - `npm test`: 7 unit tests for model choice.
  - `node e2e/run.mjs`: 12 E2E checks against a real pi in RPC mode, covering busy / idle / `wait_agents`
    delivery, batching, and model inheritance. Logs go to `e2e/artifacts/` (gitignored). The last run passed 12/12.
- Not installed in the user's pi yet. Pi still uses fork `Fatih0234/pi-subagent@5f714ca`
  (workaround: never pass `model` to that tool).

## Next steps
1. User decides whether to switch: replace the fork in `~/.pi/agent/settings.json` `packages` with
   this repo (local path or a GitHub repo), then restart pi.
2. User tries it in the interactive TUI, especially the idle notice and how results render.
3. Maybe later (only if needed): `stop_agent`, project-local agents, nicer rendering.
