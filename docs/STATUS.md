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
- User's setup pins subagents to `simpleSubagent: { model: "github-copilot/gpt-6-luna", thinking: "high" }`
  (deliberate choice; the setting stays optional in the extension).
- Live-tested in a real session: parallel spawns, batched busy delivery, `wait_agents`, settings model.

## Published
- GitHub: https://github.com/Fatih0234/pi-simple-subagent (public, MIT, release v0.1.0, topics incl. `pi-package`).
- Verified a clean install: `pi --no-extensions -e git:github.com/Fatih0234/pi-simple-subagent` loads both tools.
- Pi peer deps are marked optional. Otherwise pi's `npm install --omit=dev` on git installs pulls pi itself
  from npm, which fails behind the corporate registry.
- Discovery: awesome-pi-coding-agent (awesome-pi.site) auto-indexes GitHub/npm daily.
- **Not on npm yet**: public npm is blocked from the work network. The pi.dev/packages gallery only lists npm
  packages with the `pi-package` keyword (already in package.json). To publish from a normal network:
  `npm login --registry https://registry.npmjs.org && npm publish --registry https://registry.npmjs.org`.

## Next steps
1. User tries it in the interactive TUI, especially the idle notice and how results render.
2. Maybe later (only if needed): `stop_agent`, project-local agents, nicer rendering.
