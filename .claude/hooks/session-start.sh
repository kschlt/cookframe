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

# Fast-forward an existing checkout onto its origin. 0 = now current, 1 = could not.
sync_to_origin() {
  local dest="$1" branch
  branch="$(git -C "$dest" rev-parse --abbrev-ref HEAD 2>/dev/null)" || return 1
  git -C "$dest" fetch --quiet origin 2>/dev/null || return 1
  git -C "$dest" merge --ff-only --quiet "origin/$branch" 2>/dev/null || return 1
  return 0
}

# Mount one layer.
#
# A sibling checkout the harness may have placed next to this one is preferred as a SOURCE,
# because an environment's setup phase has no outbound access to github.com — but never as
# the authority. It is whatever some earlier session left behind, and after a force-push its
# history may not even be related to the remote's. So: clone from it for speed, then
# fast-forward onto origin; if that is impossible, discard it and clone from the remote.
# The canonical remote always wins; a stale sibling is only ever kept as a last resort, loudly.
mount_layer() {
  local dest="$1" slug="$2" name="$3" sibling="$SIBLINGS/$3"
  local url="https://github.com/$slug"

  if [ -d "$dest/.git" ]; then
    if [ -n "$(git -C "$dest" status --porcelain 2>/dev/null)" ]; then
      say "$name: present with uncommitted changes — left untouched."
    elif sync_to_origin "$dest"; then
      say "$name: up to date."
    else
      say "$name: present; could not fast-forward onto $slug — left as is, may be stale."
    fi
    return 0
  fi

  if [ -d "$sibling/.git" ] && git clone --quiet "$sibling" "$dest" 2>/dev/null; then
    git -C "$dest" remote set-url origin "$url"
    if sync_to_origin "$dest"; then
      say "$name: cloned from sibling checkout, fast-forwarded to $slug."
      return 0
    fi
    # The sibling cannot be reconciled with the remote. Prefer the remote.
    rm -rf "$dest"
    say "$name: sibling checkout diverged from $slug — discarded it."
  fi

  if git clone --quiet "$url" "$dest" 2>/dev/null; then
    say "$name: cloned from $slug."
    return 0
  fi

  # Last resort: an unreconcilable sibling beats nothing at all, but say so plainly.
  if [ -d "$sibling/.git" ] && git clone --quiet "$sibling" "$dest" 2>/dev/null; then
    git -C "$dest" remote set-url origin "$url"
    say "$name: MOUNTED FROM SIBLING WITHOUT VERIFYING against $slug — state may be stale or diverged."
    return 0
  fi

  say "$name: COULD NOT MOUNT ($slug). Attach the repository to this session, then re-run this script."
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
