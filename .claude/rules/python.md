---
paths:
  - "**/*.py"
---

# Python code

Ruff, basedpyright and the file-size check catch style, types and size; the edit hook shows their errors after each edit. These rules cover what they cannot see.

- One script is `main()` plus one function per step, each named for what it does. A step that grows its own branches becomes its own function or module.
- CLI arguments go through `argparse` (or the command-line library `.claude/rules/libraries.md` names), never `sys.argv` by hand.
- New code imports packages (`from app.client import fetch`) and runs as `uv run python -m <module>`; no new `sys.path.insert`.
- Before writing a client, a helper or a parser, look for one in the project; extend it instead of copying it.
- Never swallow an error from an external service: log what failed (which call, which id) and re-raise.
- New script names are `object_action` in snake_case: `user_export.py`, never `export-user.py`.
