# Structure

Where a new or moved file goes, in any stack. Each stack's `structure-<stack>.md` says what its units and shared folders are. Follow these rules for new and moved files; do not move existing files unless asked.

## Units and shared code

An app is split into **units**: the slices a user or a caller reaches (a page, a route, a command, a feature, a job). Code that is not a unit is **shared**.

Decide where a file goes by who imports it.

- **One unit uses it:** it goes in that unit's folder. This is the default; do not extract code before a second user appears.
- **Two or more units use it:** move it to the shared folder in the same change, into a topic subfolder named after what it is about, not after the units that use it. In a stack whose units may import each other (the stack's rule says; Node and Python do, pages and routes do not), simple pure logic moves at its second consumer, and code with behaviour or state at its third; until then the second consumer imports it from the owner's public entry.
- **Generic code with no app data** (a button, a retry wrapper, a duration format) goes in the stack's generic topic. Test: it would work unchanged in an app about something else.
- **A client of an outside service** (an API, a model provider, a file store) is shared from the start, one module per service, with the types it returns.
- **Code in another language that the project runs** (Python under a JS app) is one package in that language, not a copy in each unit folder. The language's dependency file (`pyproject.toml`) stays at the root, where the harness detects, installs and checks it. Its tests sit in that language's test folder, its subpackages follow the units that run it, and the stack's rule says where the package goes.

Before adding shared code, search the shared folder for code that already does it.

## Top level and shared code

- The top level names the product's units, not technical layers: no project-wide `controllers/`, `services/` or `models/`. Layers, if any, sit inside a unit as files named by role.
- Each kind of shared code has one place, named in the stack's rule, with topic subfolders named by content. A growing catch-all file (`utils.ts`, `helpers.py`) is not allowed.

## Imports

- The stack's rule says whether units may import each other.
  - Where they may (Node, Python), a unit reaches another only through that unit's public entry (the stack's rule names it), never its inner files.
  - Where they may not (React pages, Next.js routes, the eslint boundaries config), the code moves to shared.
- Apart from the public entry, a unit's files are imported only from inside the unit.
- Shared code never imports a unit. When shared code needs something from every unit (a list, a handler, a registration), the composition root passes it in.
- No import cycles, between files or between folders.
- Types go with the unit that owns them, and move to shared like any code, unless the stack's rule puts them elsewhere.

## Entry and composition root

One entry file per program. It reads settings, builds the service clients and mounts the units. Units do not build their own clients or read the environment.

## Folders

- **Files that belong together** (one module and its parts, or 3+ files on one topic) go in a subfolder named after them. Do not create a folder for a single file.
- A folder is named after what its code is about (`billing/`, `auth/`), never a catch-all (`utils/`, `helpers/`, `misc/`).
- At most 3–4 levels of nested folders.
- A test moves with the file it tests.

## Growing

Each step happens when it hurts, not in advance. These are recommendations, not checks.

1. One file, then a folder per unit at about 10 files or a second developer.
2. Units grouped into domains at about 15 units.
3. Workspace packages (`packages/`) when code is shared by two deployables.
4. Several apps (`apps/`) when there are two deployables.

When a skill offers several layouts, this rule and the stack's rule decide.
