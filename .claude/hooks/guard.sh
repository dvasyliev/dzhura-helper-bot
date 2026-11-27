#!/usr/bin/env bash
# Blocks, before Claude runs a tool:
# - force push and skipping git hooks, in a shell command;
# - the project's secret env files (.env, .env.local, .env.production, ...):
#   no reading, editing, searching or shell command that names one. Only
#   .env.example stays open, so new variables can be added to it.

set -uo pipefail # Run this file with bash.

input=$(cat)
cmd=$(jq -r '.tool_input.command // empty' <<<"$input")

deny() { echo "Blocked: $1" >&2; exit 2; }

# Rule 1: no force push, it rewrites history on the server. Each command of a
# chain is checked on its own, push must be a whole word and -f is lower-case,
# so a path such as .githooks/pre-push next to `git commit -F` is not one.
parts=${cmd//&&/$'\n'}
parts=${parts//||/$'\n'}
parts=${parts//;/$'\n'}
parts=${parts//|/$'\n'}
while IFS= read -r part; do
  [[ "$part" =~ (^|[[:space:]])git[[:space:]](.*[[:space:]])?push([[:space:]]|$) ]] \
    && [[ "$part" =~ [[:space:]](--force[^[:space:]]*|-f)([[:space:]]|$) ]] \
    && deny "force push. Ask the user."
done <<<"$parts"

# Rule 2: no skipping git hooks, only a human decides that.
shopt -s nocasematch
[[ "$cmd" =~ (--no-verify|(^|[[:space:];&|])SKIP_VERIFY=) ]] \
  && deny "skipping the git hooks is a human decision."
shopt -u nocasematch

# Rule 3: no secret env file: .env or .env.<anything> except .env.example.
secret() {
  [[ "$1" =~ ^\.env(\..+)?$ && "$1" != ".env.example" ]] \
    && deny "$1 holds secrets; Claude never reads or changes it. Tell the user what to put there; .env.example is open."
}

# File tools: the file or folder they work on, and Grep's file filter (.env* counts).
while IFS= read -r path; do
  name=${path##*/}
  name=${name%%\**}
  [[ -n "$name" ]] && secret "$name"
done < <(jq -r '.tool_input | (.file_path, .notebook_path, .path, .glob) // empty' <<<"$input")

# Shell commands: split into words at every character a file name does not hold
# (spaces, quotes, /, =, >, ...) and check each word whole.
while IFS= read -r word; do
  secret "$word"
done < <(tr -c 'A-Za-z0-9_.-' '\n' <<<"$cmd")

exit 0
