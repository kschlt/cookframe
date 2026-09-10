---
id: "ADR-0001"
title: "Node 22 runtime, code written against Web-standard APIs"
status: accepted
date: 2026-09-10
tags: ["runtime", "portability", "apis"]
constrained_by: ["PDR-0001"]
related_to: ["ADR-0002"]
---

## Context

Cookframe's product baseline makes self-hosting a first-class constraint and requires that the
Canonical Recipe model not depend on one deployment target. It also warns against paying for a
portability layer before a second consumer exists.

This record originally tried to decide the deployment target as well. That conflated two decisions
with very different urgency.

**What Slice 1 actually requires** is a runtime to execute in and a way to run it locally. It does
not require a hosting target.

**What the hosting decision actually needs** is a measured answer to whether the Bring adapter
requires a publicly fetchable HTTPS URL and how Bring behaves with a tokenized one. Today that is
inferred from documentation, not observed. Spike S3 produces it. Deciding the expensive, cascading
half of this question on an assumption, days before the evidence arrives, is the wrong trade.

The part that genuinely has teeth now is narrower: whether code is written against Node-specific
APIs or Web-standard ones. That choice is what decides whether a later hosting decision is cheap or
a rewrite — and it is decidable today, on principle, without naming a host.

## Decision

Run on Node 22, and write application code against **Web-standard APIs** wherever a standard
equivalent exists — `fetch`, `Request`/`Response`, `URL`, Web Streams, Web Crypto — rather than
Node-specific equivalents. Node 22 supports all of these natively, so this costs essentially nothing
today.

Use a container for local development and CI, so contributors and CI run the same runtime.

**The hosting target and reference deployment remain open as OQ-05**, to be decided by its own ADR
once S3 has reported. This record does not choose one, and does not rule any out.

## Consequences

### Positive

- A container-based self-host and an edge deployment both stay reachable, because the API surface the
  code depends on is available in both.
- The expensive decision is made when the evidence exists rather than ahead of it.
- Local development, CI and production share a runtime.
- Costs nothing to adopt: these are the platform APIs, not an abstraction over them.

### Negative

- A few Node conveniences are foregone where a standard equivalent exists, occasionally for slightly
  more verbose code.
- "Write against Web standards" is a discipline, not a mechanism; nothing enforces it until there is
  code and a lint rule to check.
- Deferring OQ-05 means the reference self-hosting path is undocumented for now, which must not be
  allowed to persist to a public release — it is on the pre-release list.

### Neutral

- S3 does not depend on this decision and must not be sequenced behind it: it can run against a
  disposable public page.

## Alternatives considered

**Commit now to a portable container with Postgres, hosting included.** The original form of this
record. Rejected as deciding more than is forced: the container half is real, the hosting half was an
assumption dressed as a decision.

**Commit now to an edge platform (Workers, D1, R2) as the primary target.** Free always-on public
HTTPS, which the Bring path may need. Rejected for now on the same grounds — and separately because
it would redefine self-hosting as platform tenancy, which is a product concern this record should not
settle unilaterally. Still open under OQ-05.

**"Portable behind clean boundaries" as an explicit abstraction layer.** Rejected as the abstraction
theatre the baseline warns about. Writing against the platform's own standard APIs achieves the same
portability with no layer.
