#!/usr/bin/env bash
# Tells Claude the project state when a session starts.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

echo "Project state at session start:"

# The dev server port: the `port` in .claude/harness.json (PORT if set); none without a dev server.
port=$(jq -r '.port // empty' .claude/harness.json 2>/dev/null)
[ -n "$port" ] && port=${PORT:-$port}

# Warn if packages are not installed.
installed=true
if [ -f package.json ] && [ ! -d node_modules ]; then
  echo "- WARNING: dependencies are not installed. Install them first."
  installed=false
fi
if [ -f pyproject.toml ] && [ ! -d .venv ]; then
  echo "- WARNING: Python dependencies are not installed (uv sync)."
  installed=false
fi
$installed && echo "- Dependencies: installed."

# Warn if the node on PATH is not the version the project asks for (.nvmrc, else .node-version).
# Only a plain version (24, v24.18, 24.18.1) is compared, whole parts at a time; aliases and ranges are skipped.
for f in .nvmrc .node-version; do
  [ -f "$f" ] || continue
  want=$(head -n 1 "$f" | tr -d '\r ')
  if printf '%s' "$want" | grep -Eq '^v?[0-9]+(\.[0-9]+){0,2}$' && have=$(node --version 2>/dev/null) && [ -n "$have" ]; then
    want=${want#v}
    case "${have#v}." in "$want."*) ;; *)
      echo "- WARNING: node on PATH is $have, the project asks for $want ($f). Hooks and checks run on $have."
    esac
  fi
  break
done

# Warn if a dev server already runs, so Claude does not start a second one.
if [ -n "$port" ]; then
  if nc -z localhost "$port" >/dev/null 2>&1; then
    echo "- WARNING: a dev server is already running on port $port. Do not start another one."
  else
    echo "- Dev server: port $port is free."
  fi
fi

# Count uncommitted changes, so Claude does not overwrite them.
changed=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
echo "- Uncommitted files: $changed. Do not discard or overwrite them."

exit 0
