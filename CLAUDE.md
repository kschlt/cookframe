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
proxy authenticates only for attached repositories. They are reconcilable, and this is measured
rather than assumed: **attachment need not happen at session start**, and a repository attached
mid-session gets git credentials without moving the working directory.

Measured 2026-09-11 in a session started with this repository alone, `git ls-remote` against
each of the three:

| | before attaching | after attaching |
| --- | --- | --- |
| `kschlt/cookframe` | `exit 0` | `exit 0` |
| `kschlt/cookframe-aos` | `exit 128` | `exit 0` |
| `kschlt/aos` | `exit 128` | `exit 0` |

The working directory stayed `/home/user/cookframe` throughout, so the hook layer survived the
attachment. The sequence is therefore:

1. Start the session with **`cookframe` as the only attached repository**. The `SessionStart`
   hook fires and reports `COULD NOT MOUNT` — correct at that moment, because the private
   repositories are not yet reachable.
2. Attach `kschlt/cookframe-aos` and `kschlt/aos` from inside the session.
3. Run the command at the top of this file. That is what mounts them.

**Cost of doing it this way: the skills are on disk but not registered in the session that
mounted them.** `reloadSkills` only has an effect when it is a hook's response to the harness; a
mount run by hand prints it to stdout, where nothing consumes it. So the `.aos` skills
(`/intake`, `/shape`, `/close`, …) are linked and readable, but not offered as commands in that
session.

### The maintainer's environment registers the bootstrap outside this repository

Measured 2026-09-14: with a `SessionStart` hook registered at a scope the working directory
cannot move — not in this repository — a session with **three repositories attached** came up
with `.aos` and `.aos/sys` mounted, the symlinks in place, and all twelve skills **invocable**,
all of it before the first action. `reloadSkills` works there because it is a real hook response.

That configuration lives in the maintainer's cloud environment, not here, and **nothing in this
repository should grow a dependency on it.** Project scope behaves exactly as the table above
says either way: `.claude/settings.json` is read only when this repository is the working
directory. What the outside registration buys is that the mount no longer needs a working
directory it cannot control.

### What is lost when no hook layer is active

With several repositories attached and no registration outside this repository, project settings
are never read, and `SessionStart`, `PreToolUse`, `PostToolUse` and `Stop` are never registered
for the session's whole lifetime — it cannot be revived from inside. The mount still works by
hand. These do not:

- **Run capture and the audit log.** `capture-pre.py` and `monitor-pre.py` are `PreToolUse`
  hooks, so `/inspect` has no run to analyse and `.aos/logs/` stays empty. The scripts
  themselves work when invoked directly.
- **The context-threshold warning.** `check-context-threshold.py` never fires, so nothing tells
  you to `/close pause` — watch context yourself.
- **The session-end state push.** Mutations auto-commit inside the instance, but the push is a
  session-boundary step: run `python3 .aos/sys/core/scripts/freshness.py end`, or the work stays
  in a container that gets reclaimed.

A registration outside this repository restores the first two only if it invokes those scripts
itself — and only if each **child process** runs with its working directory inside the project.
The aos scripts locate their instance from `AOS_INSTANCE_ROOT` or by walking up from the current
directory; they do not read `CLAUDE_PROJECT_DIR`, so passing it is not enough. The session's own
working directory is beside the point: what counts is the directory the hook's child inherits.

Measured 2026-09-14, both halves of that. A bridge that passed `CLAUDE_PROJECT_DIR` and let the
child inherit `/home/user` wrote nothing, silently, exiting zero — as a `PreToolUse` hook must.
A bridge that `cd`s into the project before running the same script filled the audit log from
the first tool call, with the session's working directory still at `/home/user`.

The last item is a session-boundary step in every configuration.

<!-- aos:begin id=task-workflow rev=1 managed by aos touchpoint writer - do not edit by hand -->
This project's backlog, session protocol, and workflow tooling are managed by **aos** (the meta-workflow layer mounted at `.aos/`). Machinery lives at `.aos/sys/`; the authoritative session protocol is `.aos/sys/core/CLAUDE.md`. Instance state (backlog, specs, work-log) lives in the nested state repo at `.aos/` (host-ignored, its own git history). Do not edit this managed region by hand.
<!-- aos:end id=task-workflow -->
