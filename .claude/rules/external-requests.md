---
paths:
  - "**/*.{js,mjs,cjs,ts,mts,cts}"
---

# External requests

Every call to a service outside the project (an API, a file store, a model provider, or a program the code runs, such as a CLI or a script in another language) keeps these rules. For a program the code runs, the exit code and stderr stand in for the status, and tests mock the spawn instead of using `msw`.

- Every call that leaves the process has a time limit, so a slow service cannot hang the server or the script. An HTTP request: `fetch(url, { signal: AbortSignal.timeout(ms) })`, a few seconds for a plain call, longer for an upload or a download. A child process (`spawn`, `execFile`): `timeout`, or `signal: AbortSignal.timeout(ms)`, and a kill of the child when the limit is reached.
- Every call to a service goes through that service's client (one module per service), which sets the time limit, the retries and the error handling. A call never sets them on its own.
- Code that sends many requests to one service at once (one per item of a list) caps how many run together, below the point where the service starts refusing them.
- Retry only with `p-retry` (or the retry library `.claude/rules/libraries.md` names), only inside the service's client, and only failures that can pass on their own: a timeout, a network error, 429, 502, 503, 504. Never retry another 4xx: the same request fails the same way.
- Two or three tries at most, each waiting longer than the last plus a random part (jitter). A `Retry-After` header sets the wait.
- Retry a write only when doing it twice changes nothing (`PUT`, `DELETE`, or an idempotency key).
- Never wrap a client call in a second retry: the tries multiply.
- Log every failure with the service, the status and how long it took.
- Tests never call a live or paid service: they mock HTTP with `msw` (or the HTTP mocks library `.claude/rules/libraries.md` names).
