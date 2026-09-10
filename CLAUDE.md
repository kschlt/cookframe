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

There is a `SessionStart` hook in `.claude/settings.json` that runs the same script. **It does
not fire in this environment — do not rely on it.** Measured with a dependency-free canary
registered under every hook event: eight registrations, none fired, across `SessionStart`,
`PreToolUse`, `PostToolUse` and `Stop`, and across every matcher form including none at all. In
the same sessions `CLAUDE.md` and `.claude/skills/` load normally. The hook is kept because it
does work in a local CLI session; in a cloud session the instruction above is the mechanism.

Once mounted, read `.aos/sys/core/CLAUDE.md` for the session protocol and work from there. Only
the bootstrap — `.claude/settings.json` and `.claude/hooks/` — is in this repository; the tool,
its skills and all of its state live under `.aos/`, which is not tracked here.

### Consequences of the hook layer being inert

Worth knowing before you trust something that is supposed to happen by itself:

- **No run-capture and no audit log.** `capture-pre.py` and `monitor-pre.py` are `PreToolUse`
  hooks, so `/inspect` has no run to analyse and `.aos/logs/` stays empty. The scripts
  themselves work when invoked directly.
- **No context-threshold warning.** `check-context-threshold.py` never fires, so nothing tells
  you to `/close pause` — watch context yourself.
- **State is pushed only when someone pushes it.** Mutations auto-commit inside the instance,
  but the push is a session-boundary step: `python3 .aos/sys/core/scripts/freshness.py end`, or
  the work stays in a container that gets reclaimed.

<!-- aos:begin id=task-workflow rev=1 managed by aos touchpoint writer - do not edit by hand -->
This project's backlog, session protocol, and workflow tooling are managed by **aos** (the meta-workflow layer mounted at `.aos/`). Machinery lives at `.aos/sys/`; the authoritative session protocol is `.aos/sys/core/CLAUDE.md`. Instance state (backlog, specs, work-log) lives in the nested state repo at `.aos/` (host-ignored, its own git history). Do not edit this managed region by hand.
<!-- aos:end id=task-workflow -->
