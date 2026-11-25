#!/usr/bin/env bash
# Keeps Claude out of the project's secret env files (.env, .env.local,
# .env.production, ...): no reading, editing or shell command that names one.
# Only .env.example stays open, so new variables can be added to it.

set -uo pipefail # Run this file with bash.

input=$(cat)

deny() {
  echo "Blocked: $1 holds secrets; Claude never reads or changes it. Tell the user what to put there; .env.example is open." >&2
  exit 2
}

# A secret env file name: .env or .env.<anything> except .env.example.
secret() {
  [[ "$1" =~ ^\.env(\..+)?$ && "$1" != ".env.example" ]]
}

# File tools: the file or folder they work on, and Grep's file filter (.env* counts).
while IFS= read -r path; do
  name=${path##*/}
  name=${name%%\**}
  [[ -n "$name" ]] && secret "$name" && deny "$name"
done < <(jq -r '.tool_input | (.file_path, .notebook_path, .path, .glob) // empty' <<<"$input")

# Shell commands: split into words at every character a file name does not hold
# (spaces, quotes, /, =, >, ...) and check each word whole.
cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
while IFS= read -r word; do
  secret "$word" && deny "$word"
done < <(tr -c 'A-Za-z0-9_.-' '\n' <<<"$cmd")

exit 0
