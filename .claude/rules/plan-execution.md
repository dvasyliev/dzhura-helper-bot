# Plan execution

How to carry out a plan from `superpowers:writing-plans`, whatever it is for: a feature, the fixes of an audit. A sentence marked with a module (such as "With `vitest`") applies only when that module is in the harness modules listed in `.claude/rules/harness.md`.

Do not ask how to carry out the plan; choose:

- **Default:** do every task yourself in this session (`superpowers:executing-plans`).
- **Plan long enough that its later tasks would run on a compacted conversation, or a risky change that needs a review after each task:** use `superpowers:subagent-driven-development`: one subagent per task, in order, with a review after each. Skip its worktree setup and its finishing step: work where the feature already is (`main`, or the worktree the `feature-workflow` rule set up), and finish as that rule says. A long plan alone is no reason for a worktree; each implementer commits only its own files.

## Subagents

Subagents that implement a task do not run `npm run check`; the Stop hook does. With `vitest` or `pytest`, they run only the unit tests of the files they touch (`npx vitest run <files>` or `uv run pytest <files>`). With `dupes`, they run `npm run dupes` before committing, and with `knip`, `npm run knip`: these find duplicates and unused exports across files, which a review of one task misses. With `playwright`, the subagent on the end-to-end task runs only its spec files, never `npm run verify`, which runs once after the last task.
