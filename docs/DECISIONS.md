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
