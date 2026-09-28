---
name: parallel-worktrees
description: Split independent coding tasks across git worktrees and background subagents, then review and ship each one.
disable-model-invocation: true
---

# Parallel worktrees

You are the coordinator. Workers implement, and you plan, set up, review and ship. Your own cwd stays in the main checkout for the whole run. Address worktrees with `git -C <wt>` and absolute paths, so removing a worktree never deletes the directory your shell runs in.

## 1. Split the work

A task gets its own worktree when it needs isolated verification (its builds and tests must not see other workers' half-done edits) or its own branch and PR. Tasks that must land in order, or that rewrite the same files, become one task. Read-only work such as research or review needs no worktree: spawn it with the default cwd.

Done when every task has a slug (`auth-timeout`), a goal, and a check that proves it works.

## 2. Check the base

In the main checkout, run `git status --porcelain` and `git rev-parse --abbrev-ref HEAD`. Worktrees start from committed history, so workers cannot see uncommitted changes. If the tree is dirty, ask the user whether to commit first or go ahead without those changes. Record the base branch and commit. Every diff and PR compares against it.

## 3. Create the worktrees

`<root>` is the absolute path `git rev-parse --show-toplevel` prints in the main checkout. Worktrees go in the sibling directory `<root>.worktrees`. Create them one at a time:

```bash
git worktree add -b agent/<slug> <root>.worktrees/<slug> <base>
```

A new worktree holds only tracked files. Copy in the ignored files a task needs that cannot be regenerated, such as `.env`. Workers install dependencies themselves.

If the repo has project pi config (`.pi/settings.json`, `.pi/skills`, `.pi/extensions`), pi skips it for workers in an untrusted directory. Ask the user once to trust `<root>.worktrees` in pi.

## 4. Write the task file

Each worktree gets one task file, at the path this prints:

```bash
git -C <wt> rev-parse --path-format=absolute --git-path pi-task.md
```

The file sits in git's private directory for that worktree. It cannot be committed, it does not block `git worktree remove`, and it is deleted with the worktree. It is the handoff between you and successive workers, so keep it short:

```markdown
# <slug>
Base: <branch>@<sha>  Branch: agent/<slug>  Worktree: <absolute path>

## Goal
## Why
## Done when
## Constraints
## Findings
## Changes
## Verification
## Review / next
```

You fill Goal through Constraints. Workers fill the rest. Write the Done-when check as one command that starts with `cd <wt> &&`, so it gives the same result for you and for the worker.

## 5. Spawn the workers

Call `spawn_agent` once per worktree with `cwd` set to the worktree's absolute path and this task:

```text
You work in the git worktree <wt> on branch agent/<slug>.
1. Read <task file>. It is your task and the durable record of this work.
2. Set the worktree up so the Done-when check can run (install dependencies).
3. Investigate, then implement the Goal inside this worktree.
4. Run the Done-when check.
5. Commit on agent/<slug>, staging explicit paths with `git add <paths>`. The coordinator pushes and opens PRs.
6. Update Findings, Changes, Verification and Review / next in the task file.
Final answer: outcome, verification result, and anything unresolved.
```

Then do coordinator work that does not depend on the workers. When none is left, call `wait_agents()`. It returns as soon as one worker finishes. Review that worktree (step 6) while the others keep running. Their results arrive on their own while you work, and when you run out of work you call `wait_agents()` again. Results never wake you when you are idle, so ending your turn stalls the run until the user writes again.

## 6. Review every result

Review each worktree as soon as its result arrives. A worker's final answer is a claim. For each worktree:

1. Read the task file.
2. Run `git -C <wt> status --short` and `git -C <wt> log --oneline <base>..HEAD`.
3. Read `git -C <wt> diff <base>...HEAD` in full and compare it against Goal and Constraints.
4. Run the Done-when command from the task file yourself, exactly as written. Every bash call starts in the main checkout, so a check without its `cd <wt> &&` tests the wrong code.

For a large change, also spawn a reviewer subagent with the same `cwd` (the named `reviewer` agent, if one exists) and tell it to report findings without editing.

Write findings into `## Review / next`. To address them, spawn a fresh worker with the same `cwd` and the same task. It resumes from the task file and the git history.

Done when every task is approved, or its open problems are written in Review / next.

## 7. Ship

Push and open PRs for approved tasks only, in the form the user asked for (draft or ready, one PR per task by default). Write each PR body from the diff and the task file: what changed, why, and how it was verified. If there is no remote or `gh` is not authenticated, stop at the local branches and say so.

## 8. Clean up

After a branch is merged, or the user abandons it:

```bash
git worktree remove <wt>
git branch -d agent/<slug>
```

`git worktree remove` refuses when the worktree has uncommitted changes. Find out what they are before you pass `--force`. Delete an unmerged branch with `-D` only after the user confirms. `git worktree prune` clears registrations whose directory is gone.

Finish with one line per task: branch, PR or local status, verification result, open problems.
