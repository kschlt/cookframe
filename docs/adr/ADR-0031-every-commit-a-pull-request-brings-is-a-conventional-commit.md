---
id: "ADR-0031"
title: "Every commit a pull request brings is a Conventional Commit, and CI refuses one that is not"
status: accepted
date: 2026-09-22
tags: ["process", "ci", "commits"]
related_to: ["ADR-0022", "ADR-0029"]
---

## Context

This project writes Conventional Commits. The rule was declared in exactly one place: the
maintainer's private workflow configuration (`conventions.commit_format: conventional`), which this
repository ignores and a contributor never sees. Nothing in the repository stated it, and nothing
checked it — no hook, no CI job.

On 2026-09-22 the maintainer noticed subjects on `main` that do not follow it. Counted over the last
60 subjects on `main`, 9 were conventional. The other 51 have three separate causes, and a fix for
one does nothing for the others:

- **28 base merges inside branches** — `Merge branch 'main' into …`. Some came from `git merge` with
  git's default subject, some from GitHub's "Update branch" button, whose subject GitHub fixes.
- **14 pull-request merges** — `Merge pull request #N from …`, GitHub's default merge-commit text.
- **9 content commits** written with a prose subject, or with a type the private tooling does not
  declare.

The content commits are the ones a rule can reach, and there were two reasons nothing reached
them. The tooling that writes conforming subjects (`/commit`) exists in a session only when the
private workflow layer is mounted, and that needs the `kschlt/aos` repository attached to the
session. A session without it has no such tool and writes subjects freely. That was measured in
another thread, where the start hook reported `COULD NOT MOUNT (kschlt/aos)`. And a session that
does have the tool can still run `git commit` directly, which several threads confirmed they did.
Both are true at once. Either way, whether the rule applied depended on how a session was started.

## Decision

**The rule lives in this repository, and CI refuses a pull request that breaks it.**

- `CONTRIBUTING.md` states the rule. The private configuration is no longer where anyone has to
  look for it.
- A `commits` job runs on every pull request. It checks **every commit the pull request brings**,
  meaning every commit reachable from its head and not from the base tip fetched when the job runs.
  It also checks **the pull request's title**. The job is pull-request only, because on a push to
  `main` the commits have already landed.
- **The rule:** `type(scope)!: description`, with the scope and the `!` optional. The types are
  `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style` and `test`.
  The header is at most 100 characters, with no trailing period and no leading or trailing
  whitespace. The description's case is not constrained, because this project writes German as
  well as English, and a German noun starts with a capital letter.
- **One exception, and it is measured.** A commit with two or more parents and git's or GitHub's
  standard merge subject is exempt: its subject is not written by its author, and GitHub's "Update
  branch" button can only write that subject. The exemption needs both halves. A single-parent
  commit that only reads like a merge is refused, and so is a real merge whose subject someone
  wrote by hand. The check reports what it exempted by SHA, so the survivors are listed rather than
  asserted.
- **Breadth is pinned, as `ADR-0029` requires.** The range is walked whole, including merges and
  commits reachable only through a merge's second parent. The proofs compare it with `git rev-list`
  of the same range, and name the second-parent commit a narrower walk would miss. Three narrowings
  are measured red: first parent only, skipping merges, and the last commit only.
- **The title is checked, because it becomes a subject on `main`.** Since #91 the merge step
  passes the pull request's title as the merge commit's subject on every merge. A pull-request
  merge commit never appears in a pull request's range, because it does not exist until the
  merge, so this check on the title is the only place in the repository that guards that
  subject before it exists. The title gets no merge exception: it has no parents to qualify it.

## Consequences

### Positive

- A prose subject, or an invented type, can no longer reach `main` through a pull request. That
  holds whether or not the session that wrote it had the private tooling, because the check is in
  the public repository.
- Anything the private `/commit` tooling writes passes. Its six types are a subset of the eleven
  above.
- Both halves of the merge exception are planted away on their own and go red, so the exception
  cannot quietly widen to "anything that starts with Merge".

### Negative

- **Whether the title becomes the merge subject is decided outside this repository.** The merge
  step passes it today, and the repository setting that makes GitHub use the title by default
  would do the same without it. Nothing in the repository can check that the step keeps doing so.
  A merge made without it writes GitHub's `Merge pull request #N from …` onto `main`, and no
  check here sees that commit.
- **Base merges written by git keep git's subject on `main`**, because they are exempt. Writing
  them by hand as `chore: merge main into <branch>` is recommended in `CONTRIBUTING.md` but not
  required, since requiring it would turn every use of GitHub's "Update branch" button red.
- **An edited title is not re-checked until the next push.** The workflow's `pull_request` trigger
  does not list `edited`, and adding it would re-run every job in the workflow on every edit of a
  title or a description. A title edited after the last push reaches `main` unchecked.
- **History is not rewritten.** The subjects already on `main` stay as they are, and nothing checks
  them.
- **The private tooling's own table is narrower** — six types, without `build`, `ci`, `perf`,
  `style` and `revert`. It never writes anything this rule refuses. It does call `build(deps): …`
  undeclared, and that `build(deps): …` is what Dependabot writes and what this repository already
  uses. Aligning that table belongs to the tooling, not to this repository.

## Alternatives considered

**commitlint with its conventional preset.** Rejected for two reasons. It is a new development
dependency and configuration for a rule that is one regular expression and a list. And its defaults
exempt merge commits by their subject text alone, so a single-parent commit whose subject starts
with "Merge" passes unexamined — an exemption nobody measures. Its preset also constrains the
description's case in ways that refuse ordinary German.

**A `commit-msg` git hook.** Rejected: a hook is local, a contributor has to install it, and
`--no-verify` skips it. It fails in exactly the way the private tooling did: it applies where
someone set it up and nowhere else.

**Squash merging, with the title as the only commit.** It would make every subject on `main` the
guarded title, and it would make this check mostly unnecessary. It also changes how this
repository's history is built and how the merge step works (`ADR-0022`). That is the maintainer's
decision, not one a commit guard should take on the way past.

**No merge exception.** Rejected: GitHub's "Update branch" button writes a subject nobody can
change, so every pull request that used it would be red for a commit its author did not write.
