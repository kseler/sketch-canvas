#!/usr/bin/env bash
# Claude Code PreToolUse hook (registered in .claude/settings.json).
# Enforces CLAUDE.md's "pnpm typecheck and pnpm test must pass before any commit": before Claude
# runs a Bash command that contains `git commit`, run both, and block the command if either fails.
#
# Input: the tool call as JSON on stdin. Exit 0 = let the command run. Exit 2 = block it; what we
# print on stderr is shown to Claude so it can fix the problem.
# Only Claude's commits go through this. Commits you make yourself are still checked by CI.
set -uo pipefail

# If the input can't be read, warn (exit 1 = visible, non-blocking) instead of passing silently.
# Not exit 2: this hook sees every Bash command, so a broken jq must not block all of them.
if ! command=$(jq -r '.tool_input.command // empty' 2>/dev/null); then
  echo "check-before-commit: could not read the hook input; commit checks skipped." >&2
  exit 1
fi

# `git commit` at the start of the command or after ; & | ( or a space, optionally `git -C dir`.
# A command that only mentions it (echo "git commit") also matches; then the checks just run.
if ! grep -qE '(^|[;&|( ])git( +-C +[^ ]+)? +commit( |$)' <<<"$command"; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 2

if ! output=$(pnpm typecheck 2>&1 && pnpm test 2>&1); then
  {
    echo "Commit blocked by .claude/hooks/check-before-commit.sh: pnpm typecheck or pnpm test failed."
    echo "Fix the failures, then commit again. Last lines of the output:"
    tail -n 40 <<<"$output"
  } >&2
  exit 2
fi
exit 0
