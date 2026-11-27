---
paths:
  - "**/*.py"
---

# External requests

Every call to a service outside the project (an API, a file store, a model provider) keeps these rules.

- Every call has a time limit, so a slow service cannot hang the program. An HTTP request has a `timeout` (ruff `S113` fails without it): a few seconds to a minute for a plain call, a longer read timeout for an upload or a download (`timeout=(10, 600)`). A child process has `subprocess.run(..., timeout=...)`, or `communicate(timeout=...)` on a `Popen` with a kill on `TimeoutExpired`.
- Retry only with `tenacity` (or the retry library `.claude/rules/libraries.md` names), and only inside the service's client. An `except` that calls again counts as a retry.
- Tests never call a live or paid service: they mock HTTP with `responses` (or the HTTP mocks library `.claude/rules/libraries.md` names).
