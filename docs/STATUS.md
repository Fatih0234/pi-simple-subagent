# Status

_Last updated: 2026-09-28_

## Where we are
- Phase: **design discussion**. No implementation yet.
- Collected and analyzed 14 reference implementations → `resources/ANALYSIS.md`.
- Draft design with open questions → `docs/DESIGN.md`.
- Still in use in the meantime: fork `Fatih0234/pi-subagent@5f714ca` (configured in pi settings).
  Workaround until replaced: **never pass `model`** to that tool.

## Next steps
1. Settle remaining open questions: process model (subprocess vs in-process) and exact delivery
   rule (steer-while-busy? notify user when idle?). Tool surface, optional agent, cap=8 are decided.
2. Spike: minimal subprocess child + `ctx.model` inheritance + background delivery via `sendMessage`;
   measure child startup time.
3. E2E check inside a real pi session: spawn 3 background agents, keep working, confirm all
   3 results arrive exactly once and the right model ran.
4. Switch the pi settings from the mjakl fork to this extension.
