# Cookframe — agent instructions

**Run this before anything else:**

```bash
bash .claude/hooks/session-start.sh && python3 .aos/sys/core/scripts/freshness.py start
```

It mounts the maintainer's private workflow layer, or prints that it cannot. **`COULD NOT
MOUNT` is the normal outcome for anyone but the maintainer** — not an error, and nothing in
Cookframe depends on it. Stop there and carry on with the repository as it is. Details in
*Maintainer workflow* below.

Start at [`docs/README.md`](docs/README.md): the product and architecture baseline, the decision
records, and the open questions.

Two rules that are easy to break without knowing them:

- **An accepted decision record is never rewritten.** A decision changes by a new record that
  supersedes it — see [`docs/adr/README.md`](docs/adr/README.md).
- **Do not add an index that lists records and their status.** The next record added makes it
  wrong, silently. Open questions belong in [`docs/open-questions.md`](docs/open-questions.md).

---

## Maintainer workflow — optional; ignore this section if it does not apply to you

Cookframe is built with a private workflow tool. **Nothing in the product depends on it**: the
code, tests, build and documentation are complete without it, and it is unavailable unless you
have access to the maintainer's private state repository.

### About the command at the top of this file

**Run it even when `.aos/` already exists.** A container can be reused between sessions, so a
present `.aos/` may be inherited from an earlier one and stale — measured two commits behind on
2026-09-10. The first command mounts or re-syncs; the second is the tool's own session-start
check and pulls the instance up to its remote. Both are idempotent.

**If it reports `COULD NOT MOUNT`, stop here and ignore the rest of this section.** That is the
expected outcome for anyone but the maintainer, and it is not an error to fix. For the
maintainer it means `kschlt/cookframe-aos` and `kschlt/aos` are not reachable from this session.

### Whether the hook fires depends on how the session was started

There is a `SessionStart` hook in `.claude/settings.json` that runs the same script. In a cloud
session it fires only when **this repository is the session's working directory**. Measured
2026-09-11, in two otherwise identical sessions:

| | `cookframe` attached alone | three repositories attached |
| --- | --- | --- |
| working directory | `/home/user/cookframe` | `/home/user` |
| `.claude/settings.json` | loaded | not loaded |
| `.mcp.json` (a diagnostic, since removed) | loaded | not loaded |
| `SessionStart` hook | **fires** | no trace |
| `CLAUDE.md`, `.claude/rules/`, `.claude/skills/` | loaded | loaded |
| cloning an unattached private repository | `could not read Username` | resolves |

With more than one repository attached, the working directory is their common parent, so nothing
project-scoped in this repository is read. That is the whole mechanism. The number of attached
repositories matters only because it decides the working directory.

An earlier version of this file said the hook never fires, and that `.claude/settings.json` is
not loaded at all in this environment. **Both claims were wrong.** They rested on a session
whose canary had already been deleted, so an absent trace proved nothing either way. The script
now writes an unconditional entry line to `/tmp/cookframe-aos-mount.log`, which makes "did it
run" answerable afterwards instead of inferable.

`.claude/settings.json` carries one deliberate oddity for this reason: an `env` entry
`COOKFRAME_SETTINGS_CANARY`. `echo "$COOKFRAME_SETTINGS_CANARY"` answers "were project settings
loaded at all" in one call, and unlike a `permissions` probe it cannot be confounded by the
session's permission mode. Keep it.

### Attach this repository alone, then attach the private ones from inside the session

The two requirements pull against each other. The hook needs this repository to be the only
attachment; the mount needs the private repositories to be attached, because the credential
proxy authenticates only for attached repositories. They are reconcilable, because attachment
need not happen at session start: a repository attached mid-session gets credentials without
moving the working directory.

So start the session with **`cookframe` alone**, and attach `kschlt/cookframe-aos` and
`kschlt/aos` as the first action, before running the command at the top of this file. The
`SessionStart` hook will already have reported `COULD NOT MOUNT`, because at that moment the
private repositories were not yet reachable. That is expected, and the run at the top of the
file is what mounts them.

### What is lost when the hook layer is inert

A session started with several repositories attached has no hook layer for its whole lifetime,
and it cannot be revived: `SessionStart` does not re-fire, and `PreToolUse`, `PostToolUse` and
`Stop` are never registered at all. The mount still works by hand. These do not:

- **Run capture and the audit log.** `capture-pre.py` and `monitor-pre.py` are `PreToolUse`
  hooks, so `/inspect` has no run to analyse and `.aos/logs/` stays empty. The scripts
  themselves work when invoked directly.
- **The context-threshold warning.** `check-context-threshold.py` never fires, so nothing tells
  you to `/close pause` — watch context yourself.
- **The session-end state push.** Mutations auto-commit inside the instance, but the push is a
  session-boundary step: run `python3 .aos/sys/core/scripts/freshness.py end`, or the work stays
  in a container that gets reclaimed.

<!-- aos:begin id=task-workflow rev=1 managed by aos touchpoint writer - do not edit by hand -->
This project's backlog, session protocol, and workflow tooling are managed by **aos** (the meta-workflow layer mounted at `.aos/`). Machinery lives at `.aos/sys/`; the authoritative session protocol is `.aos/sys/core/CLAUDE.md`. Instance state (backlog, specs, work-log) lives in the nested state repo at `.aos/` (host-ignored, its own git history). Do not edit this managed region by hand.
<!-- aos:end id=task-workflow -->
