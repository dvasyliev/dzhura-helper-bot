---
paths:
  - "**/*.{js,mjs,cjs,ts,mts,cts}"
---

# Structure in Node.js

How `structure.md` applies to a Node.js server, bot or command-line tool. Paths below start at the source folder (`src/` unless the project set another).

- **Folders:** the project picks one parent folder for its units and one name for shared code, and keeps them: `src/modules/` with `src/shared/`, or `src/features/` with `src/lib/`.
- **Inside a unit:** files are flat and named `<thing>.<role>.ts` (`order.routes.ts`, `order.service.ts`, `order.schema.ts`). A subfolder appears only by the Folders rule of `structure.md`.
- **Public entry:** units may import each other, only through `index.ts`. A unit's `index.ts` is its public API: it exports what the composition root mounts and what other units may call. Nothing else is imported from outside the unit.
- **Generic code:** `shared/<what it does>.ts`, never `utils.ts` (with the project's shared folder name).
- **Command-line tools:** a command's file mirrors the command path (`commands/db/migrate.ts` for `tool db migrate`).
- **Imports:** inside a unit, `./`. To shared code, `#` subpath imports (`"imports": { "#shared/*": "./src/shared/*" }` in `package.json`) when the project has them, else relative paths that never enter another unit's inner files.
- **SDKs and ORMs:** each is imported in one shared module (its client), never in units.
- **Tests:** unit tests next to their file (`<name>.test.ts`); end-to-end tests in a root `tests/` or `e2e/` folder.
- **Monorepo:** only when Growing in `structure.md` says so, with workspace packages, each with its own `package.json` and public entry.
- **Override:** where `nodejs-backend-patterns` shows a layer-first tree (`src/controllers/`, `services/`, `utils/`), keep its layers as role-named files inside each unit.
- **With `dependency-cruiser`:** the `deps` check enforces the imports above. The units and shared folders are the `UNITS` and `SHARED` constants at the top of `.dependency-cruiser.cjs`. When a folder is renamed, change them.
