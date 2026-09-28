# Decision log

Append-only. Newest at the bottom. Format: date — decision — why.

- 2026-09-28 — Write a new extension from scratch instead of further patching `mjakl/pi-subagent`.
  Why: two rounds of problems came from the design itself (LLM-chosen models, too many knobs,
  blocking only), not just from wording.
- 2026-09-28 — The LLM never chooses the model. Resolution order: agent frontmatter → extension
  settings → main session's current model. Fail loudly if a configured model is unavailable.
  Why: the main agent guessed `anthropic/claude-*` model names and retried them; model
  choice is a cost decision for the user.
- 2026-09-28 — Worktrees, terminal panes, workflows/chains and persistent sessions are out of scope.
  Why: the user handles isolation separately; simplicity is the main requirement.
- 2026-09-28 — Background agents are in scope and feasible through `pi.sendMessage(..., { triggerTurn, deliverAs })`.
- 2026-09-28 — Tool surface = Option B: `spawn_agent({ task, agent? })` (always background, returns id)
  + `wait_agents({ ids? })`. Why: one mental model ("everything runs in background"), parallel for free.
- 2026-09-28 — `agent` is optional. Omitted → general-purpose child with the main agent's tools.
- 2026-09-28 — Default concurrency cap = 8.
- 2026-09-28 — Results do NOT wake an idle main agent (no extra paid turn). Pending (see STATUS):
  exact delivery while busy vs idle.
- 2026-09-28 — Children run as separate `pi` processes (isolation, simple kill). Measure boot time in the prototype.
- 2026-09-28 — Delivery: main agent busy → slip result into the current run (no extra turn).
  Main agent idle → don't wake it; hold for the user's next message + show a UI notice.
  `wait_agents` for when the main agent needs results now.
- 2026-09-28 — Batch results that finish while the main agent is busy into one steer message at `turn_end`.
  Why: pi injects one queued steer message per turn, so per-result messages cost one extra model call each
  (seen in E2E run 1).
- 2026-09-28 — Configured models must be "provider/id"; fuzzy names are rejected so pi can't pattern-match
  them to an unintended model.
