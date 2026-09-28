# Status

_Last updated: 2026-09-28_

## Where we are
- **v0.1 prototype works.** `index.ts` (tools + delivery), `runner.ts` (child process), `model.ts` (model choice).
- Tests:
  - `npm test`: 7 unit tests for model choice.
  - `node e2e/run.mjs`: 12 E2E checks against a real pi in RPC mode, covering busy / idle / `wait_agents`
    delivery, batching, and model inheritance. Logs go to `e2e/artifacts/` (gitignored). The last run passed 12/12.
- **Installed** (2026-09-28): `~/.pi/agent/settings.json` `packages` now points to this folder
  (local path, loaded live, so edits apply on the next pi start). The mjakl fork was removed.
  Backup: `~/.pi/agent/settings.json.bak-before-simple-subagent`.

## Next steps
1. User tries it in the interactive TUI, especially the idle notice and how results render.
2. Maybe later (only if needed): `stop_agent`, project-local agents, nicer rendering.
