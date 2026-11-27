const fs = require("node:fs");

// Setup writes this: the folders whose subfolders are units (features, modules, ...), as a path
// regex. Change it when the project's units live in other folders; a "src/" prefix is optional.
// Use only non-capturing groups (?:...): a (...) group breaks the rules.
const UNITS = "(?:src/)?features/";
// Setup writes this: the folders of code every unit may use (shared, lib, ...), as a path regex.
// Change it when the project's shared code lives in other folders.
const SHARED = "(?:src/)?lib/";

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment:
        "Modules must not import each other in a circle (see structure.md).",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "shared-not-to-units",
      comment:
        "Shared code must not import a unit, only the other way round (see structure.md).",
      severity: "error",
      from: { path: `^${SHARED}` },
      to: { path: `^${UNITS}` },
    },
    {
      name: "units-through-entry",
      comment:
        "A unit is imported only through its public entry, its index file (see structure.md).",
      severity: "error",
      from: { path: `^(${UNITS})([^/]+)/` },
      to: {
        path: "^$1",
        pathNot: ["^$1$2/", "^$1[^/]+/index\\.[cm]?[jt]sx?$"],
      },
    },
    {
      name: "units-independent",
      comment:
        "A unit should not import another unit at all (see structure.md). Raise this to error for full isolation.",
      severity: "warn",
      from: { path: `^(${UNITS})([^/]+)/` },
      to: { path: "^$1", pathNot: "^$1$2/" },
    },
  ],
  options: {
    parser: "swc",
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(node_modules|dist|build|coverage)/|(^|/)\\." },
    ...(fs.existsSync("tsconfig.json")
      ? { tsConfig: { fileName: "tsconfig.json" } }
      : {}),
    cache: {
      folder: "node_modules/.cache/dependency-cruiser",
      strategy: "content",
    },
  },
};
