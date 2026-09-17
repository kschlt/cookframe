---
id: "ADR-0009"
title: "Byte storage is a filesystem volume behind storageIdentity"
status: accepted
date: 2026-09-17
tags: ["storage", "media", "self-hosting", "persistence"]
decides: ["OQ-06"]
constrained_by: ["PDR-0001"]
related_to: ["ADR-0003", "ADR-0005", "PDR-0002"]
---

## Context

Slice 1 needs somewhere to put bytes from its first run. `PDR-0001`'s tenth invariant keeps scan
deletion disabled until the capture-quality gate passes, so captured images are **retained** — the
question is not whether a byte store exists but which one, and it is forced now rather than later.

The recipe ontology already built the indirection this decision sits behind: hero media is
addressed by a `storageIdentity`, is explicitly optional, and is *not* recipe ground truth. Source
assets are transient by design — retained only while deletion stays disabled. So the store holds
data that is either regenerable, re-addable by the user, or scheduled for deletion. None of it is
the provenance the product promises to preserve; that lives in the Source Snapshot and the Canonical
Recipe, which `ADR-0003` puts behind the repository interface.

`PDR-0002` settled the deployment posture as a self-hosted single-user container the operator runs
on their own infrastructure, which removes the option set that only existed on a platform. What is
left is a choice among stores an operator can actually run, judged against `ADR-0005`'s one
`docker compose up`.

The self-hosting principles name "optional media/object storage" as a boundary to keep explicit, and
require that data not be trapped in opaque provider-specific formats with a defined export and
backup contract before public release. Both point the same way: the store should be the one whose
backup story a single operator can state in a sentence.

## Decision

**Byte storage is a filesystem volume, addressed through the existing `storageIdentity`
indirection.** No object-storage service, no bytes in the database.

`storageIdentity` stays the only way the rest of the system refers to stored bytes. No filesystem
path appears outside the storage implementation, on the same terms `ADR-0003` sets for persistence
and `ADR-0004` sets for the model provider: the concrete store is confined to its implementation, so
replacing it touches that implementation and no callers.

The volume holds retained scan images while deletion is disabled, and hero media where retained.
Its backup contract is the directory.

## Consequences

### Positive

- The composition stays at one service. An operator runs `docker compose up` and backs up a
  directory and a database; there is no third thing to learn, run or monitor.
- It does not presuppose `OQ-03`/`OQ-04`. Putting bytes in the database would have meant choosing a
  database in order to store an image, months before Slice 1's three deciding queries exist — the
  accidental decision this sequence is built to avoid.
- Reversible by construction. `storageIdentity` already exists in the ontology, so a later move to
  S3-compatible storage swaps one implementation rather than migrating a data model.
- The backup and export contract the principles require before public release is trivially stateable
  for a directory, and hard to get wrong.
- Large binaries stay out of the database, so database backups stay proportional to the recipe data
  rather than to the image data.

### Negative

- A filesystem volume is not replicated, versioned or checksummed by default. The operator owns
  durability, and a directory lost is a set of retained scans lost — which matters precisely because
  invariant 10 keeps them as the only re-capture path until the quality gate passes.
- Writes to the filesystem and writes to the database are not one transaction. A crash between them
  can leave an orphaned file or a `storageIdentity` pointing at nothing, and the implementation has
  to reconcile rather than rely on atomicity.
- It assumes a persistent disk. That is true of the reference deployment by construction, and would
  stop being true if `OQ-05` ever closed on a platform without one — which is the coupling named
  below.
- Concurrent access from more than one process is the operator's problem. V1 is single-user and
  single-composition, so this is bounded today and would need revisiting if that changed.

### Neutral

- This record decides nothing about hero-image variants, formats or compression — that is `OQ-19`,
  which this record unblocks rather than answers.
- It decides nothing about the database (`OQ-03`, `OQ-04`), which remains open and is closed by its
  own record after Slice 1.

## Alternatives considered

**S3-compatible object storage, self-hosted (MinIO) or remote.** A standard API, portable, and the
obvious answer for a library that outgrows one disk. Rejected for V1 because it adds a second
required service to the composition against `ADR-0005`, and because the workload does not justify
it: a single user's retained scans and optional hero images fit a disk comfortably. The
`storageIdentity` indirection is what makes this a later swap rather than a foreclosed option.

**Bytes in the database.** One store, one backup, one transaction — genuinely attractive, and it
would remove the orphaned-file failure mode named above. Rejected because it presupposes the
database decision that Slice 1 is meant to *inform*, and because it couples image data to the
persistence engine at exactly the moment that engine is deliberately provisional.

**Keeping no bytes at all and referencing the original source URL.** The cheapest option, and
consistent with hero media being non-authoritative. Rejected outright for scans, which invariant 10
requires retaining, and rejected for hero media because it makes the library depend on the source
site staying up and leaks the user's library reads to that site every time a page renders.

## What would falsify this decision

- **`OQ-05` closes on a target without a persistent local disk.** The posture makes that unlikely,
  but it is the one environmental assumption this record rests on.
- **The orphan-reconciliation cost turns out to be non-trivial** in practice — enough dangling files
  or dangling identities that a transactional store would have been cheaper than the reconciliation
  it replaced.
- **A library outgrows a single disk**, or a multi-instance deployment appears, either of which makes
  the object-storage alternative worth its second service.
- **The capture-quality gate passes and deletion is enabled**, materially shrinking retained bytes.
  That does not reverse this decision, but it removes the largest reason the store has to be
  durable, and is worth re-reading this record against.
