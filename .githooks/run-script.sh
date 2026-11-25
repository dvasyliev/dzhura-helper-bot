#!/usr/bin/env sh
# Runs a package.json script on files with the project's package manager: run-script.sh <script> <file>...
# lint-staged calls it (.lintstagedrc.json), adding the staged files.
if [ -f pnpm-lock.yaml ]; then pm=pnpm; else pm=npm; fi
script=$1
shift
exec "$pm" run -s "$script" -- "$@"
