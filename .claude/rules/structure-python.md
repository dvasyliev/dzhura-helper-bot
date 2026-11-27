---
paths:
  - "**/*.py"
---

# Structure in Python

How `structure.md` applies to a Python project. Paths below start at the package, `src/<package>/`.

## Layout

- **Package:** a root `pyproject.toml` with a build system and `[project.scripts]`, and the code in `src/<package>/` (what `uv init --package` makes).
- **Mixed repo:** when the other language also uses `src/`, the package is `src/<package>/` next to that code, and `pyproject.toml` stays at the root (`structure.md`, "Code in another language that the project runs").
- **No build system:** a project made with plain `uv init` cannot import its own package from tests or import-linter. Add one (`uv init --package` writes it) when it gets a second module folder.

## Units and shared code

- **Units:** domains (`python-project-structure`, Pattern 7), not layers (its Pattern 6), as soon as there are two domains: `<package>/<units>/<unit>/`. While there is one, layers may be modules of the package.
- **Units import each other:** yes, only through the unit's `__init__.py`.
- **Public entry:** a unit's `__init__.py`. A module named with a leading `_` is private to its package.
- **Shared place:** one shared subpackage, chosen once per project and kept (`<package>/shared/`), with topic subpackages or modules inside it.
- **Generic topic:** modules named by what they do (`shared/retry.py`), never `utils.py` or `helpers.py`.
- **Composition root:** the `[project.scripts]` entry or `__main__.py` parses arguments, builds the clients and calls the units.

## Imports and tests

- **Imports:** absolute, as `python-project-structure` says. No `sys.path` changes.
- **Tests:** the parallel `tests/` folder (`python-project-structure`, Pattern 4, Option B), run with `--import-mode=importlib`, which the pytest config sets.

## Enforced

- **With `import-linter`:** the contracts in `.importlinter` enforce the imports above: shared never imports a unit, and units have no cycles. A line under `ignore_imports` that no longer matches fails with `No matches for ignored import ...`, so fixing a violation means deleting its line.
