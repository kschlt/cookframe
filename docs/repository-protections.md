# Repository protections

The settings that govern `kschlt/cookframe` on GitHub itself, and what is actually known about each
one. This file is the dated entry that `tests/protections/repository-claims.test.ts` requires behind
any claim, anywhere in this repository, that a platform setting is configured.

**Why a record rather than a test.** A platform setting is not repository content, and nothing here
can read one back. Measured 2026-09-22, from inside a GitHub Actions workflow using that workflow's
own `GITHUB_TOKEN`:

```
GET /repos/kschlt/cookframe               200, but with no `security_and_analysis` block
GET /repos/.../branches/main/protection   403 Resource not accessible by integration
GET /repos/.../vulnerability-alerts       403 Resource not accessible by integration
GET /repos/.../automated-security-fixes   403 Resource not accessible by integration
```

`permissions: administration: read` does not fix it and cannot be declared: a workflow asking for it
is rejected outright, the run failing with zero jobs, while the identical file without that key runs
green. The only thing that would work is an admin-scoped token stored as a repository secret — and on
a public, contribution-open repository that token is a larger exposure than any setting it would
prove. So these are recorded by a person, with a date, and the record says plainly that no test reads
them.

**One trap, written down so nobody re-derives it.** `GET /repos/kschlt/cookframe/branches/main`
answers `200` with `protected: true` to an anonymous caller, and it embeds a `protection` object
reading `enabled: false`, `enforcement_level: "off"`, `contexts: []`. That object is not the state of
this repository — it is what comes back *without admin rights*. A test asserting on it would be red
while protection is on; a test asserting its `contexts` are empty would be **green while measuring
the opposite of what it claims**. Never assert on an API field whose value depends on the caller's
rights.

---

## Branch protection on `main`

- **State:** enabled
- **Verified by:** Kornelius (repository owner, who set it)
- **Verified on:** 2026-09-22
- **Machine-checkable:** no — the rules require admin rights to read, and the one field an anonymous
  caller does get (`protected: true`) says nothing about which checks are required or whether a
  branch must be up to date, which is the part that matters here.

Set 2026-09-22 09:40. What it requires: the `merge-gate` check, and that a branch be up to date with
`main` before merging. The second half is why merges on this project are serial — after each merge
every other open pull request is stale and must pull `main` and re-run.

That `merge-gate` is the required check's exact name was established by observation rather than
assumed: pull request #44 ran twelve checks, exactly one of them named `merge-gate`. No API available
to this repository reads the required-check list back.

## Secret scanning with push protection

- **State:** not enabled
- **Verified by:** nobody yet
- **Verified on:** —
- **Machine-checkable:** no — `security_and_analysis` is absent from the repository object for every
  caller available here, and the related endpoints answer `403`.

**This is an open item, recorded as open rather than quietly omitted.** It needs the repository owner
to switch it on; nothing in this repository can do it, and nothing here can confirm it afterwards.
When it is enabled, this section gets a state, a name and a date, and not before.

Worth having for the reason `docs/open-source-self-hosting-principles.md` §5 gives: the repository is
public and open to contribution, so push protection is worth having in place *before* there is much
to push, rather than after an accident.

## Dependency update automation

- **State:** enabled, as repository content
- **Verified by:** read from the tree by `protections/dependency-automation-is-in-the-tree`
- **Verified on:** 2026-09-22
- **Machine-checkable:** yes — `.github/dependabot.yml` is a file, and the test reads it

This one is deliberately **not** a platform toggle. It lives at `.github/dependabot.yml`, covering
npm, GitHub Actions and Docker, so it is versioned, reviewable in a pull request, and readable by a
test. That is the whole reason it is listed here as the exception: it is the only entry on this page
a machine can confirm.

It does not cover Dependabot **security alerts**, which are a separate repository setting and are not
readable here. Version updates and security alerts are different features, and this file provides
only the first.

---

## What this page is not

It is not evidence that these settings are on. A person wrote it, and a person can be wrong or out of
date. What the test behind it enforces is narrower and worth stating exactly: **no document in this
repository may claim a platform setting is configured unless this page carries a dated entry for it.**
That closes the failure this item was created by — `SECURITY.md` told the public that dependency
update automation was configured while no such automation existed in the tree — without pretending to
a verification that is not available.
