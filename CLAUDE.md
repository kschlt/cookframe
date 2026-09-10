<!-- aos:begin id=task-workflow rev=1 managed by aos touchpoint writer - do not edit by hand -->
This project's backlog, session protocol, and workflow tooling are managed by **aos** (the meta-workflow layer mounted at `.aos/`). Machinery lives at `.aos/sys/`; the authoritative session protocol is `.aos/sys/core/CLAUDE.md`. Instance state (backlog, specs, work-log) lives in the nested state repo at `.aos/` (host-ignored, its own git history). Do not edit this managed region by hand.
<!-- aos:end id=task-workflow -->

## If `.aos/` is missing

`.claude/hooks/session-start.sh` mounts it at session start. If it did not run, or the mount
failed, run it by hand before anything else:

```bash
bash .claude/hooks/session-start.sh
```

It needs `kschlt/cookframe-aos` (private) and `kschlt/aos` attached to the session, or a
sibling checkout of either next to this one. It prints what it mounted and what it could not.
Then read `.aos/sys/core/CLAUDE.md` for the session protocol.

## What is tracked here

`.claude/` is a real directory in this repository, not the symlink into `.aos/sys/.claude`
that aos installs by default: the bootstrap hook has to be committed or a fresh container
cannot mount itself. Only `.claude/settings.json` and `.claude/hooks/` are tracked. Skills and
agents are symlinked out of the machinery at session start and are not part of this public
repository.
