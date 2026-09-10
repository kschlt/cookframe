#!/bin/bash
# Mount the host-ignored .aos/ meta-workflow layer at session start.
#
# Two nested repositories, neither of them ever committed to this public repo:
#   .aos/       the instance / state repo  -> private  kschlt/cookframe-aos
#   .aos/sys/   the machinery              ->          kschlt/aos
# plus .claude/skills and .claude/agents, symlinked out of the machinery.
#
# A web session runs in a fresh container: everything under .aos/ is gone, so without this
# the session starts with no backlog, no skills and no session protocol. This script is the
# ignition. It never blocks a session — every path exits 0 — but it says loudly what it
# could not do, because the failure mode to avoid is silence.
#
# Idempotent: a second run re-syncs fast-forward-only and clones nothing.

set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
AOS="$ROOT/.aos"
SIBLINGS="$(dirname "$ROOT")"

STATE_REPO="kschlt/cookframe-aos"   # PRIVATE — must be attached to the session to clone
MACH_REPO="kschlt/aos"

notes=()
say() { notes+=("$1"); }

# Mount one layer. Prefers a sibling clone the harness may have placed next to this
# checkout, because an environment's setup phase has no outbound access to github.com;
# falls back to a network clone, which needs the repo attached to the session.
mount_layer() {
  local dest="$1" slug="$2" sibling="$SIBLINGS/$3"

  if [ -d "$dest/.git" ]; then
    if [ -n "$(git -C "$dest" status --porcelain 2>/dev/null)" ]; then
      say "$3: present, uncommitted changes — left untouched."
    elif git -C "$dest" fetch --quiet origin 2>/dev/null &&
         git -C "$dest" merge --ff-only --quiet '@{u}' 2>/dev/null; then
      say "$3: up to date."
    else
      say "$3: present; not fast-forwardable — left as is."
    fi
    return 0
  fi

  if [ -d "$sibling/.git" ] &&
     git clone --quiet "$sibling" "$dest" 2>/dev/null; then
    git -C "$dest" remote set-url origin "https://github.com/$slug"
    say "$3: cloned from sibling checkout; origin -> $slug."
    return 0
  fi

  if git clone --quiet "https://github.com/$slug" "$dest" 2>/dev/null; then
    say "$3: cloned from $slug."
    return 0
  fi

  say "$3: COULD NOT MOUNT ($slug). Attach the repository to this session, then re-run this script."
  return 1
}

mkdir -p "$AOS"
mount_layer "$AOS"      "$STATE_REPO" "cookframe-aos" || true
mount_layer "$AOS/sys"  "$MACH_REPO"  "aos"           || true

# Machinery skills and agents are reachable only through this repo's own .claude/, because
# .claude/ here is a real directory carrying the committed bootstrap rather than the
# symlink into the machinery that aos installs by default.
for part in skills agents; do
  if [ -d "$AOS/sys/.claude/$part" ] && [ ! -e "$ROOT/.claude/$part" ]; then
    ln -s "../.aos/sys/.claude/$part" "$ROOT/.claude/$part" && say "linked .claude/$part"
  fi
done

# The host tree must stay clean: nothing here may become a commit in the public repo.
if [ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]; then
  say "WARNING: host tree is not clean after mount — inspect before committing."
fi

printf 'aos mount: %s\n' "${notes[*]:-nothing to do}" >&2
exit 0
