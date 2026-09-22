---
id: "PDR-0006"
title: "The project is licensed under the AGPL, with copyright kept in one pair of hands"
status: accepted
date: 2026-09-22
tags: ["licensing", "posture", "product", "contribution"]
related_to: ["PDR-0001", "PDR-0002"]
---

## Context

`PDR-0001` adopted the discovery decision log's §1 wholesale as Cookframe's founding product
decisions, and one of those bullets is the licence. Quoted verbatim from
[`../archive/discovery-decision-log.md`](../archive/discovery-decision-log.md) §1, under *Product
identity*:

> - License: **MIT**

`docs/open-source-self-hosting-principles.md` carried the reasoning for it: *"The project
intentionally favors low-friction use, modification, redistribution and commercial reuse over
reciprocal/copy-left obligations."*

That reasoning was written for a product that was only ever going to be self-hosted by the person
who wrote it. On 2026-09-22 the maintainer said something discovery had not assumed: he is keeping
open the possibility of running Cookframe as a paid, hosted offering, so that someone who does not
want to keep a server, an OpenAI key and a backup schedule can get it as a service instead. He also
said he wants to keep the project open, because that is the part he likes about building it in
public.

MIT does not stop him doing either. It stops nobody else either — under MIT a third party may take
Cookframe, close it, and sell the same hosted convenience without publishing a line back. The
asymmetry the maintainer actually wants is the one the AGPL creates: **everyone else is bound by
the reciprocal obligation, and the copyright holder is not.** Offering a modified Cookframe over a
network obliges the offerer to publish their modified source; the holder of the copyright is under
no such obligation to himself and may license the same code on other terms as often as he likes.

Two things make this cheap today and expensive later, and both are measurements rather than
expectations.

**Relicensing costs nothing while one person owns all of it.** Measured against the GitHub API on
**2026-09-22 at 17:42 UTC**: `forks_count` 0, `stargazers_count` 0, `watchers_count` 0, and every
commit in `main` authored by the maintainer's own sessions. Nobody outside holds a copyright
interest, so there is nobody to ask. **That figure is a snapshot and stops being true the moment
somebody forks or contributes** — it is recorded here with its timestamp so a later reader does not
read it as a standing fact. The first merged outside contribution ends the situation permanently:
its author then owns their part, and commercial licensing of the whole needs their agreement.

**A licence change is not retroactive.** Everything published under MIT up to this record stays
available under MIT forever, and may be forked from the history by anyone. The change binds what
comes after it. That is a consequence, not an obstacle — with no forks in existence there is no
practical MIT line for anyone to continue.

## Decision

**Cookframe is licensed under the GNU Affero General Public License, version 3 or later.** The
`LICENSE` file carries the FSF's text verbatim, and `package.json` declares the SPDX identifier
`AGPL-3.0-or-later` — the "or later" form because the licence text itself recommends that wording,
and because the holder's own freedom to relicense does not depend on which form is chosen.

**Copyright stays in one pair of hands, and `CONTRIBUTING.md` carries the condition that keeps it
there.** A change from outside is merged only once its author has stated in the pull request that
the maintainer may also license their contribution on other terms, including commercially. This is
deliberately the light form of a contributor licence agreement: one sentence in a description, no
signing, no external service. A real business would need a real agreement; what this prevents is
losing the option by accident to a merge nobody thought about.

**What this record supersedes is exactly one founding item** — the `License: **MIT**` bullet quoted
above. It does not touch the rest of that section. In particular, *"Product posture: open-source,
self-hosted, single-user-first"* stands unchanged: the AGPL is an open-source licence, and
`PDR-0002` reaffirmed the self-hosted single-user reference deployment on its own grounds. The body
of `PDR-0001` is not edited, per its own instruction that a revised founding decision is replaced by
a new record quoting it rather than by a rewrite.

Alternatives considered and rejected:

- **BUSL 1.1, PolyForm Noncommercial, the Functional Source License, Elastic License 2.0.** Each
  would reserve the hosted-service right more tightly than the AGPL does. All of them are
  source-available rather than open source, which is the property the maintainer said he wanted to
  keep, and each buys protection against a risk — a large provider reselling a one-person recipe app
  — that is theoretical at this size.
- **Staying on MIT and relying on being first.** Defensible, and it is what Ghost does. It was
  rejected because it gives away the one thing that costs nothing to keep.
- **Going private.** Always still available, under any licence, and therefore not a reason to
  choose one now.

## Consequences

### Positive

- The hosted-offering option is protected without closing the source, and without asking anybody's
  permission, for as long as the copyright stays undivided.
- A third party may still self-host, fork and change Cookframe freely; what they may not do is offer
  a changed version as a service while keeping the changes.
- The contribution condition exists *before* the first outside contribution rather than after it,
  which is the only order in which it works.

### Negative

- The AGPL is a deterrent to some contributors and to some commercial users, which is the intended
  effect pointed the other way. For a project with no contributors yet, the cost is unmeasurable
  today and may not stay that way.
- The repository now needs a copyright holder named somewhere for the dual-licensing claim to have
  an addressee. `README.md` says "its maintainer" because no name is recorded anywhere in the tree;
  filling in the real one is a one-line change only the maintainer can make. **The gap is declared
  rather than guessed**, per `PDR-0005`'s rule for a required field with no source value.
- Nothing in the test suite enforces any of this. There is no check that `LICENSE`, `package.json`
  and the prose agree, and the measurement above cannot be re-run by the gate. A later drift between
  them will be found by a person reading, or not at all.
