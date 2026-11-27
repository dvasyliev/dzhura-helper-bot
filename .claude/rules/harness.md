# Harness

Written by the codebase-harness plugin from `.claude/harness.json`; do not edit by hand.

Harness modules: core, tsc, basedpyright, prettier, feature-workflow, oxlint, ruff, file-size, knip, dependency-cruiser, vulture, deptry, dupes, vitest, pytest, commitlint, pre-commit, sync-deps, node-practices, python-practices, context7, libraries. Specs and plans are written in English.

## Commands

```bash
npm run check           # all checks at once, as the Stop hook runs them
npm run typecheck       # TypeScript; never `tsc --noEmit`
uv run basedpyright  # Python types (basedpyright)
npm run format          # Prettier, whole repo
npm run format:check    # Prettier check only
npm run format:file     # Prettier on one file (used by the edit hook)
npm run lint            # oxlint, no warnings allowed
npm run lint:file       # oxlint on one file (used by the edit hook)
uv run ruff check .  # Ruff lint
uv run ruff format --check .  # Ruff format check only
uv run ruff format  # Ruff format on one file (used by the edit hook)
uv run ruff check --fix --force-exclude  # Ruff lint with fixes on one file (used by the edit hook)
bash .claude/checks/file-size.sh src  # fails for a .py file over 500 lines
npm run knip            # unused files, exports and dependencies
npm run deps            # import boundaries between units and shared code (dependency-cruiser)
npm run deps:baseline   # records today's boundary violations, so only new ones fail
uv run vulture src --min-confidence 80  # unused Python code (vulture)
uv run deptry . --experimental-namespace-package  # unused, missing and transitive Python dependencies (deptry); a folder without __init__.py counts as the project's own package
npm run dupes           # duplicated code (jscpd)
npm run test            # all unit tests (Vitest); `npx vitest run <file>` for one
uv run pytest || [ $? -eq 5 ]  # all Python tests (pytest); green with none yet (exit 5, no tests collected)
npm run prepare         # turns on the git hooks in .githooks/ (the install runs it)
```
