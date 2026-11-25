---
paths:
  - "tests/**/*.py"
---

# Python tests

- Tests sit in `tests/` and run with pytest (`uv run pytest`).
- Tests never call a live or paid API: mock HTTP with `responses` (or the HTTP mocks library `.claude/rules/libraries.md` names), and fake any other external service.
- A test needs no network, no credentials and no files outside the repo and a temporary folder.
