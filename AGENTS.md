# Agent instructions

Read `README.md` (why), `docs/STATUS.md` (where we are), `docs/DESIGN.md` (what) before working.

- Simplicity is the product. Before adding a parameter, option, file or mode, ask whether the
  goal holds without it. Default answer: don't add it.
- Never add a `model`/`thinking` parameter to a model-facing tool, and never put example model names
  in tool descriptions or prompts.
- Keep state files current: update `docs/STATUS.md` at the end of each work session and append
  to `docs/DECISIONS.md` when a decision is made.
- `resources/repos/` holds third-party reference code (gitignored; `resources/fetch.sh` restores it).
  Read it for ideas; don't copy large chunks, and respect their licenses.
- Verify with a real pi session (E2E) first; unit-test only the tricky logic (model resolution,
  delivery de-duplication, output truncation).
