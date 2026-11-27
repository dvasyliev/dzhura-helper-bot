---
paths:
  - "**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"
---

# JavaScript code

The linter and the type check catch style and types; the edit hook shows their errors after each edit. These rules cover what they cannot see.

- Before writing a helper, a client or a parser, search the project for one. Extend it instead of copying it.
- Never swallow an error. `.catch(() => {})`, `.catch(() => undefined)` and an empty `catch {}` lose it. Log what failed (which call, which id) and rethrow, or handle it in a way the user sees. Ignore an error only when it is expected and harmless, and say why in a comment on that line (`.catch(() => {}) // the file is already removed`).
- A retry is a retry in any shape. `.catch(() => call())`, a loop, or a second call in `catch` are all retries, and they follow the stack's retry rule: one place, the retry library, only failures that can pass on their own.
