# Cookframe — agent instructions

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

To find out whether it applies to you, run:

```bash
bash .claude/hooks/session-start.sh
```

It prints what it mounted, or that it could not. **If it reports `COULD NOT MOUNT`, stop here and
ignore the rest of this section** — that is the expected outcome for anyone but the maintainer,
and it is not an error to fix.

If it mounts, read `.aos/sys/core/CLAUDE.md` for the session protocol and work from there. Only
the bootstrap — `.claude/settings.json` and `.claude/hooks/` — is in this repository; the tool,
its skills and all of its state live under `.aos/`, which is not tracked here.

<!-- aos:begin id=task-workflow rev=1 managed by aos touchpoint writer - do not edit by hand -->
This project's backlog, session protocol, and workflow tooling are managed by **aos** (the meta-workflow layer mounted at `.aos/`). Machinery lives at `.aos/sys/`; the authoritative session protocol is `.aos/sys/core/CLAUDE.md`. Instance state (backlog, specs, work-log) lives in the nested state repo at `.aos/` (host-ignored, its own git history). Do not edit this managed region by hand.
<!-- aos:end id=task-workflow -->
