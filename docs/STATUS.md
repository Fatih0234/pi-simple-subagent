# Status

_Last updated: 2026-09-28_

## Where we are
- **v0.2 works.** Adds an optional `cwd` to `spawn_agent` (child pi runs in it; validated to
  exist up front, shown in the spawn reply and result header) and ships the user-invoked
  `skills/parallel-worktrees` skill (coordinator pattern: one worktree + `agent/<slug>`
  branch per task, worker spawned with `cwd`, task file at `git rev-parse --git-path
  pi-task.md`, workers commit, coordinator reviews/pushes). See docs/DESIGN.md.
- Tests (2026-09-28, model openai-codex/gpt-6-luna):
  - `npm test`: 7/7 unit tests pass.
  - `node e2e/run.mjs openai-codex/gpt-6-luna`: 22/22. Covers busy/idle/wait delivery,
    batching, model inheritance, `cwd`, and the new wait semantics: wait_agents without
    ids returned only the finished result plus a "Still running:" note, the slow result
    arrived later exactly once, and wait_agents with ids waited for both.
    Artifacts: `e2e/artifacts/run-2026-09-28T18-14-16-225Z.jsonl` (+ `.summary.json`).
  - `node e2e/worktrees.mjs openai-codex/gpt-6-luna`: 16/16. Worktrees land in
    `<toy>.worktrees/` next to the repo, the coordinator re-ran each Done-when check
    exactly as written (`cd <wt> && node --test ...`), diffs stayed separate, no
    `pi-task.md` or `.pi/` in commits, no push/PR attempts, main checkout untouched.
    It used the next-result wait: two wait_agents calls, reviewed fix-shout while
    fix-add was still running. (A previous run scored 15/16 after the coordinator ran
    one bare `node --test` in the main checkout; the skill now writes Done-when as one
    `cd <wt> &&` command.)
    Artifacts: `e2e/artifacts/worktrees-2026-09-28T18-14-16-260Z/`, toy repo kept at
    `/tmp/pi-wt-e2e-J1t12Y/toy`.
- Installed on this laptop (2026-09-28) with `pi install /home/fatih/playground/pi-simple-subagent`
  (local path, so edits apply on the next pi start). Earlier install notes in this file's history
  refer to the development machine, which used GitHub Copilot models.
- No `simpleSubagent` setting is configured in `~/.pi/agent/settings.json`, so subagents
  inherit the session model.
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
1. User tries `/skill:parallel-worktrees` on a real repo. Watch how the coordinator uses
   the next-result wait (wait_agents without ids returns at the next finished worker).
2. Maybe later (only if needed): `stop_agent`, project-local agents, nicer rendering.
