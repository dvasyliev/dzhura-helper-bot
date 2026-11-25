#!/usr/bin/env bash
# Fails when a .py file in the given folders has more than 500 lines.
limit=500
status=0
while IFS= read -r file; do
  lines=$(wc -l < "$file" | tr -d ' ')
  if [ "$lines" -gt "$limit" ]; then
    echo "$file: $lines lines, limit $limit"
    status=1
  fi
done < <(find "${@:-.}" -name '*.py' -not -path '*/.venv/*' -not -path '*/node_modules/*' -not -path '*/__pycache__/*' | sort)
exit $status
