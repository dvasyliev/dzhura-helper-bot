# Workflow

## Features

- For every user-facing feature, use the `feature-workflow` skill before writing any code.
- After a large change made without that skill (a refactor, the fixes of an audit), invoke the `improve-harness` skill.

## Setup outside the code

When a change needs something the code cannot set up itself (a store or bucket on the host, a binding, an environment variable, a setting in the host's dashboard):

- Read how to set it up and what it costs in the service's current docs (through Context7 when available), never from memory.
- Before building it, tell the user what it needs and what it costs on their plan.
- Do what the service's CLI can do after the user agrees; for a dashboard step, give the exact place and value.
- Write each new environment variable into the project's docs, and into its example env file when it has one, so the next deployment has it.
- Tell the user to add each new variable to their own `.env`, with its value or where to get it: Claude cannot open `.env`.
- Before calling the work done, check the setup is in place (the CLI lists it, or the deployed page uses it); until then, say plainly that it is not.

## Where to work: `main` or a worktree

Work on `main` by default; no branches or PRs, even when a skill suggests them. The one exception is a worktree (its own folder and branch, `.claude/worktrees/<name>/`), and only after the user agrees. Before a feature's plan is carried out, offer one with `AskUserQuestion` ("Worktree" or "On main"), saying which of these applies:

- `git status` shows changes you did not make (another agent is working on `main`);
- the user says another session will work in this repo at the same time;
- the work is an experiment the user may throw away.

Otherwise do not offer one: a small change or a plain plan stays on `main`, however long. Never offer one when the session already works in a worktree. The user may also ask for a worktree at any time.

In a worktree:

- First commit the feature's spec and plan on `main` (only those files): the worktree starts from the local `HEAD`, and you cannot edit `main`'s files from inside it.
- Create it with `EnterWorktree` (name: the feature, in kebab-case), never with `superpowers:using-git-worktrees` or `git worktree add`. It gets the env files listed in `.worktreeinclude`.
- First install the dependencies there (`npm install`, and `uv sync` on Python): the worktree has none.
- With a dev server: run it on a free port other than the one in `.claude/harness.json`, and set `PORT` to that port for every command that needs it (`PORT=<port> npx playwright test ...`).
- Commit there as on `main`. The hooks check the worktree.
- When the feature is done and its checks are green, bring it to `main`:
  1. In the worktree: `git rebase main`. If it moved the commits, run the `check` script there.
  2. `ExitWorktree` with `keep`.
  3. On `main`: `git merge --ff-only worktree-<name>`, then `git worktree remove .claude/worktrees/<name>` (after `git worktree unlock` if git says it is locked) and `git branch -d worktree-<name>`.
  
  If a step fails for any reason (a conflict, `main` moved again, another agent's uncommitted edits in the way), tell the user and wait. If `ExitWorktree` says this session did not create the worktree, give the user these commands to run from `main` instead.
- If the user throws the experiment away: `ExitWorktree` with `remove`, `discard_changes` only after they confirm.

## Several agents on `main`

- Several agents may work in this repo at the same time. Changes you did not make are another agent's work in progress, not a mess to clean up.
- Touch only your own changes. Never revert, reformat, stash or commit another agent's files.
- Before editing a file, check `git status`. If it has changes you did not make, tell the user which file and wait instead of editing it.
- If the end-of-turn checks fail, first make sure none of the failures come from your own changes. If they all sit in another agent's files, finish with one short line saying so; do not analyse, list or fix them.
- Commit only your own files (`git add <paths>`, never `git add -A`).
- Never run implementer subagents in parallel: they share one working tree (`main` or the feature's worktree).

## Questions

- Ask every question that has ready answer options (including "apply this?" after a proposal) with `AskUserQuestion`, never as plain text at the end of a reply. This holds inside `superpowers:brainstorming` too, even where it says to ask open questions in text; only a question with no sensible options stays in text.
- In `AskUserQuestion`: picking any number from a list is `multiSelect: true`; choosing one of several ways is `multiSelect: false`, the recommended option first with "(recommended)" after its label, and only ways a reasonable person could really pick (never one made up to fill the question; with one sensible way, do not ask how); one item on its own gets "Fix" (or what will happen) and "Skip". Headers are at most 12 characters, plain words in the user's language rather than abbreviations; labels 1–5 words; the tool adds "Other" itself. A question takes 2–4 options and a call 4 questions; split more evenly (5: 3 and 2) so none is left with one option, and never merge two items into one option to make them fit. Each question and option must make sense without the chat, which the dialog may hide.
