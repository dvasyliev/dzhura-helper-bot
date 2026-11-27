---
paths:
  - "**/*.py"
---

# Python code

Ruff (`S110`, `BLE001` included), basedpyright and the file-size check catch style, types and size; the edit hook shows their errors after each edit. These rules cover what they cannot see.

- One script is `main()` plus one function per step, each named for what it does. A step that grows its own branches becomes its own function or module.
- CLI arguments go through `argparse` (or the command-line library `.claude/rules/libraries.md` names), never `sys.argv` by hand.
- New code imports packages (`from app.client import fetch`) and runs as `uv run python -m <module>`; no new `sys.path.insert`.
- Before writing a client, a helper or a parser, look for one in the project; extend it instead of copying it.
- A narrow `except SomeError:` that returns `None` or a default also hides the error, and the checks do not see it. Log what failed (which call, which id) and re-raise, or say in a comment why it is safe.
- A handler that must keep going after any error (a command's top level, a worker loop) logs with `logging.exception(...)`, which `BLE001` accepts. Only where that does not fit: `# noqa: BLE001` with the reason.
- New script names are `object_action` in snake_case: `user_export.py`, never `export-user.py`.
