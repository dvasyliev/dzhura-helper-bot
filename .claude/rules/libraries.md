---
paths:
  - "**/*.{js,mjs,cjs,ts,mts,cts}"
  - "**/*.py"
---

# Libraries

When to use what the platform gives and when to reach for a library. The platform here means Node.js and its built-in modules (`node:fs`, `node:util`, `fetch` and the rest). One library per job.

## How to choose

Go through these in order and stop at the first that fits.

1. **Logic specific to this project** (its data rules, permissions, domain calculations): write it. No library knows it.
2. **The platform solves the whole job:** use it. It adds no dependency.
3. **The platform solves only part of it, and the rest needs workaround code:** use a library.
4. **Generic logic is written, or is about to be written, more than once:** use a library, if the logic is hard to get right (retries, parsing, validation). If the repeat is a few simple lines, a shared helper is enough.

A job from a section below uses that section's choice. For a job not listed, ask the user before adding a library. A library must have a stable release at least two years old (or come from a team with that record), a release in the last six months, wide use, TypeScript types and support for the project's Node.js version.

## Using a library

- When Context7 is not available, read the library's official docs.
- Add a library when the first code needs it (`npm install`, `npm install -D` for one only the tests or tools use).
- These rules are for new code. Do not rewrite old code to match them until the user asks for that specific rewrite. Then do it one library at a time.

## Dates and numbers

**Platform:** `Intl` and `Date`.

**Library:** date-fns, only for calculations these cannot do, such as time zone arithmetic.

## Validation

**Platform:** TypeScript types and JSDoc check nothing at run time; data from outside the code can be anything.

**Library:** Zod for data from outside the code: request bodies, query values, files, settings from the environment. Do not check these by hand or cast them.

- Validate where the data comes in (a route, a script's input); code behind it gets typed data and does not check again.
- Validate a third-party API's response only where a wrong answer would do real harm.

## HTTP

**Platform:** `fetch` for every HTTP call, each with a time limit (`signal: AbortSignal.timeout(ms)`).

## Retries

**Platform:** one try; a failure goes back to the caller. No hand-written retry loop around `setTimeout`.

**Library:** p-retry for a call that can pass on its own (a timeout, 429, 502, 503, 504), only inside the service's client.

- Never wrap a client call in a second retry: the tries multiply.

## HTTP mocks in tests

**Platform:** `vi.mock` on the client's function, when the request itself does not matter.

**Library:** MSW in every test whose code sends an HTTP request. Tests never call a live service.

## Working on the platform alone

No library for these unless the rules above change:

- A time limit on a request: `AbortSignal.timeout()`.
- A script's command-line arguments: `util.parseArgs` from `node:util`. Never read `process.argv` by hand.
- Settings from a `.env` file: `node --env-file=.env`.

# Python

The rules and sections above are for the JavaScript and TypeScript code. For the Python code, the platform means Python and its standard library; a library must have type hints and support for the project's Python version, and is added with `uv add` (`uv add --dev` for one only the tests or tools use). One library per job.

## HTTP

**Platform:** `urllib.request` only for a one-off call in a script: no sessions, no connection reuse.

**Library:** Requests for every HTTP call. Every request passes a `timeout` (ruff `S113` fails without it).

## Retries

**Platform:** one try; a failure goes back to the caller. No hand-written retry loop with `time.sleep`.

**Library:** Tenacity for a call that can pass on its own (a timeout, 429, 502, 503, 504), only inside the service's client.

- Never wrap a client call in a second retry: the tries multiply.

## HTTP mocks in tests

**Platform:** `unittest.mock` on the client's function, when the request itself does not matter.

**Library:** Responses in every test whose code sends an HTTP request. Tests never call a live service.

## Command line

**Platform:** `argparse` for a script with a few arguments. Never read `sys.argv` by hand.

**Library:** Typer for a tool with subcommands or many options: the arguments and the help come from the function's type hints.

## Data validation

**Platform:** `dataclasses` for data the code builds itself; they check nothing at run time.

**Library:** Pydantic for data from outside the code: request bodies, files, settings from the environment. Do not check these by hand or cast them.

- Validate where the data comes in; code behind it gets typed models and does not check again.
- Validate a third-party API's response only where a wrong answer would do real harm.

