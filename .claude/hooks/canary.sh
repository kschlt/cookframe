#!/bin/bash
# TEMPORARY DIAGNOSTIC — delete once the hook question is settled.
#
# Answers one question and nothing else: which hook events, if any, fire in this
# environment from a repository's own .claude/settings.json?
#
# Deliberately dependency-free. No .aos, no guards, no repository paths, no git. If this
# does not fire, nothing about the aos mount is at fault and no repo-side change can help.
# Every registration passes a distinct label, so the log is a truth table over hook events
# AND over matcher syntax.
#
# Writes to /tmp so it can never pollute the repository or an ignored-path assumption.

LOG=/tmp/cookframe-hook-canary.log
printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${1:-nolabel}" >> "$LOG" 2>/dev/null
printf '{"systemMessage": "hook canary fired: %s"}\n' "${1:-nolabel}"
exit 0
