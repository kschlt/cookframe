---
id: "PDR-0003"
title: "The iOS Shortcut ships from the repository, with an instance-scoped ingest credential"
status: accepted
date: 2026-09-17
tags: ["mobile", "shortcut", "distribution", "credentials", "product"]
decides: ["OQ-11"]
related_to: ["PDR-0001", "PDR-0002"]
---

## Context

A native iOS application is a stated non-goal, which makes the Shortcut the product's mobile
client rather than a convenience wrapper around it. It is where the central claim is tested: the
scan-and-shop journey starts by photographing a page, and "the critical requirement is low
friction". It is also the first thing a new self-hoster has to set up, so its distribution is part
of the product's first-run experience.

Two constraints already bound it. The self-hosting principles permit the repository to carry the
"iOS Shortcut definition/instructions" while forbidding credentials and private instance
identifiers in it; and they draw the credential boundary explicitly — never expose model-provider
credentials to the browser or the Shortcut, though "a client may hold only an instance-scoped
ingest credential if required". `PDR-0001`'s eighth invariant states the first half as a
non-negotiable: model and provider credentials never reach the browser or the iOS Shortcut.

What was left open as `OQ-11` is the packaging and distribution mechanism, and it matters because
the two obvious answers pull in opposite directions. The artifact that is easiest to install is a
share link to a prebuilt Shortcut, which lives outside the repository and cannot be read in a pull
request. The artifact that is easiest to audit is a file in the repository, which the user then has
to import and configure by hand.

## Decision

**The Shortcut definition is committed to the repository and is the source of truth.** It carries no
credentials and no instance identifiers; the instance base URL and the ingest credential are
supplied by the operator at setup, as configuration.

**A hosted share link may be published as a convenience mirror**, generated from the committed
definition. It is never the only copy, and never the authoritative one. If the mirror and the
repository disagree, the repository is right.

**The ingest endpoint authenticates with an instance-scoped ingest credential** — scoped to
submitting a capture to that one instance, and to nothing else. It is not a model-provider
credential, it cannot be exchanged for one, and it grants no access to the library beyond
submission.

## Consequences

### Positive

- The mobile client is auditable like the rest of the product: it arrives by pull request, it is
  versioned with the code it talks to, and a change to it is reviewable. That is what the twelfth
  founding invariant asks of every shipped file.
- Publishing the mirror costs nothing extra, because it is generated from the committed artifact
  rather than maintained beside it.
- The credential boundary is stated in the one place a reader will look for it, and it is narrow
  enough that losing the device does not expose the library or the model account.
- A self-hoster who distrusts the mirror has a complete path without it.

### Negative

- Setup is several manual steps — import the definition, set the base URL, paste the credential —
  against the one tap that a prebuilt link offers. That is friction on the exact journey the product
  claims is low-friction, and the documentation carries the burden of making it short.
- Keeping the mirror in step with the committed definition is a release step that can be forgotten,
  and a stale mirror is worse than none because it fails in a way the user cannot diagnose.
- An instance-scoped ingest credential is still a secret on a phone. It bounds the blast radius; it
  does not remove it.

### Neutral

- Whether the mirror is published at all is left to the operator of the reference instance. The
  decision here is that it may exist and what it may not become.

## Alternatives considered

**A hosted share link as the only distribution.** It is the lowest-friction option and it is how
most Shortcuts are shared. Rejected because the artifact would live outside the repository, could
not be reviewed in a pull request, and would sit badly with the invariant that every shipped file is
public and inspectable. A binary the project asks people to install, that nobody can read, is the
wrong shape for a tool whose whole posture is auditability.

**A documented build-it-yourself procedure with no shipped artifact.** Rejected as the highest
friction of the three, on the journey least able to afford it. It also makes every user's client
subtly different, which turns any capture bug into an unreproducible one.

**No credential on the ingest endpoint, relying on the URL being unguessable.** Rejected: an
unguessable URL is a capability, and the self-hosting principles are explicit that a capability
which may leave the device needs to be revocable. A credential can be rotated without changing the
endpoint; a secret path cannot.
