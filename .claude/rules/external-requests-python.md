---
paths:
  - "**/*.py"
---

# External requests

Every call to a service outside the project (an API, a file store, a model provider) keeps these rules.

- Every HTTP request has a `timeout` (ruff `S113` fails without it), so a slow service cannot hang the program: a few seconds to a minute for a plain call, a longer read timeout for an upload or a download (`timeout=(10, 600)`).
- Every call to a service goes through that service's client (one module per service), which sets the time limit, the retries and the error handling. A call never sets them on its own.
- Retry only with `tenacity` (or the retry library `.claude/rules/libraries.md` names), only inside the service's client, and only failures that can pass on their own: a timeout, a connection error, 429, 502, 503, 504. Never retry another 4xx: the same request fails the same way.
- Never wrap a client call in a second retry: the tries multiply.
- Tests never call a live or paid service: they mock HTTP with `responses` (or the HTTP mocks library `.claude/rules/libraries.md` names).
