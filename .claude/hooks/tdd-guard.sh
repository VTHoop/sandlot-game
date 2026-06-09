#!/usr/bin/env bash
# TDD integrity guard (PostToolUse hook)
# Blocks the turn when test-integrity violations are detected in the just-edited file.
# Violations: .skip/.only added, test cases removed, assertions removed, coverage thresholds lowered.
set -uo pipefail

input=$(cat)
tool_name=$(printf '%s' "$input" | jq -r '.tool_name // empty')
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')

[[ "$tool_name" == "Edit" || "$tool_name" == "Write" ]] || exit 0
[[ -n "$file_path" && -f "$file_path" ]] || exit 0

diff=$(git diff HEAD -- "$file_path" 2>/dev/null || true)

# New/untracked files have no diff — still check for .skip/.only in file content
if [[ -z "$diff" ]]; then
  if grep -qE '\.(skip|only)\s*\(' "$file_path"; then
    printf 'TDD guard: .skip or .only modifier found in new test file %s — remove before proceeding.\n' "$file_path"
    exit 2
  fi
  exit 0
fi

added()   { printf '%s\n' "$diff" | grep -E '^\+' | grep -vE '^\+\+\+'; }
removed() { printf '%s\n' "$diff" | grep -E '^-'  | grep -vE '^---';    }

# 1. .skip or .only added
if added | grep -qE '\.(skip|only)\s*\('; then
  printf 'TDD guard: .skip or .only modifier added to a test in %s — remove before proceeding.\n' "$file_path"
  exit 2
fi

# 2. Test case or describe block removed
if removed | grep -qE '^-\s*(it|test|describe)\s*\('; then
  printf 'TDD guard: test case or describe block removed from %s — restore the test or justify the removal in its own commit.\n' "$file_path"
  exit 2
fi

# 3. Assertion removed
if removed | grep -qE 'expect\s*\('; then
  printf 'TDD guard: assertion (expect) removed from %s — restore or fix the assertion rather than removing it.\n' "$file_path"
  exit 2
fi

# 4. Coverage threshold lowered (vitest/jest config files only)
if printf '%s\n' "$file_path" | grep -qE '(vitest|jest)\.config\.(ts|js|mts|mjs)$'; then
  for key in lines functions branches statements; do
    old_val=$(removed | grep -oE "${key}[[:space:]]*:[[:space:]]*[0-9]+" | grep -oE '[0-9]+$' | head -1)
    new_val=$(added   | grep -oE "${key}[[:space:]]*:[[:space:]]*[0-9]+" | grep -oE '[0-9]+$' | head -1)
    if [[ -n "$old_val" && -z "$new_val" ]]; then
      printf 'TDD guard: coverage threshold "%s" removed from %s — thresholds are a ratchet and may only go up.\n' "$key" "$file_path"
      exit 2
    fi
    if [[ -n "$old_val" && -n "$new_val" ]] && (( new_val < old_val )); then
      printf 'TDD guard: coverage threshold "%s" lowered from %s to %s in %s — thresholds are a ratchet and may only go up.\n' \
        "$key" "$old_val" "$new_val" "$file_path"
      exit 2
    fi
  done
fi

exit 0
