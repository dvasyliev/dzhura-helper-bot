---
paths:
  - "**/*.{test,spec}.{js,mjs,ts}"
  - "vitest.config.*"
---

# Unit tests

- Unit tests sit next to the code as `*.test.ts` or `*.spec.ts` (`.js`, `.mjs` too), and run with Vitest in Node (`npm test`; `npx vitest run <file>` for one).
- Tests never call a live or paid service: mock HTTP with `msw` (or the HTTP mocks library `.claude/rules/libraries.md` names), and fake any other external service.
- A test needs no network, no credentials and no files outside the repo and a temporary folder.
