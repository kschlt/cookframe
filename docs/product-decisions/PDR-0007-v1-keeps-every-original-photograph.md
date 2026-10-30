---
id: "PDR-0007"
title: "V1 keeps every original photograph; scan deletion is not part of V1"
status: accepted
date: 2026-10-30
tags: ["capture", "retention", "storage", "product"]
decides: ["OQ-14"]
related_to: ["PDR-0001", "PDR-0002", "ADR-0009", "ADR-0026"]
---

## Context

`PDR-0001` adopted the discovery baseline wholesale. Its tenth invariant reads:

> 10. Scan-image deletion stays disabled until the capture-quality gate passes.

The intended product behaviour behind it was to discard source scan images after a successful
capture (`recipe-ontology.md` §2.1 and §10, `validation-and-evaluation.md` §2). That is
irreversible, so it was gated on Gate A (`CFV1-S1`): human transcriptions of a representative set,
thresholds fixed in advance (`OQ-14`), and a paid measurement run of roughly 0.75 USD.

The first real-photograph run returned FAIL (`spikes/s1-photo-gate/VERDICT.md`), and scan deletion
stayed disabled, which is what the invariant exists to guarantee. Passing the gate would still
need the thresholds decided and a human spot-check of the agreed fields, because both readers in
that run were models.

On 2026-10-30 Kornelius decided that V1 never deletes an original photograph.

## Decision

**V1 keeps every original photograph it is sent. No code path deletes, expires or overwrites a
retained source image.** The `ByteStore` stays two operations without a delete (`ADR-0009`).

- Gate A (`CFV1-S1`) is **deferred, not failed and not cancelled**. Its thresholds (`OQ-14`) and its
  paid run are not needed for V1 and are not scheduled. The work is parked in the icebox and
  reopens only if a later record decides that deletion is wanted.
- The tenth invariant of `PDR-0001` is superseded **in part**: its text stays as adopted, and this
  record replaces it with "V1 does not delete scan images". The capture-quality evaluation of
  `validation-and-evaluation.md` §2 remains useful as a measure of capture quality, but it no
  longer gates anything irreversible.
- Retaining the original also keeps re-capture possible: improved capture can be re-run against
  the stored image, which the "deleted scan" case in `recipe-ontology.md` ruled out.

Alternatives considered and rejected:

- **Run the gate now and delete on a pass.** Needs threshold decisions, human transcriptions and a
  paid run, to buy storage that is cheap at V1's size and an irreversible step nobody needs yet.
- **Delete after a retention period without a gate.** Irreversible with no evidence behind it.

## Consequences

### Positive

- The single irreversible behaviour in the product is removed from V1; nothing can lose a source.
- Re-capture and comparison stay possible for every retained image.
- The S1 spend and the transcription work are off the V1 path.

### Negative

- **Storage grows with every photograph.** The reference volume `cookframe_data` is 1 GB, which is
  roughly 200 photographs at current phone-camera sizes. Enlarging the volume, or shrinking the
  stored image, is not decided here: a shrinking experiment is reported separately. Until one of
  them lands, a full volume is an operational limit of the reference deployment.
- The wording "transient" for source assets in `adapter-architecture.md` and `recipe-ontology.md`
  no longer describes V1; those documents are corrected with this record.
- Privacy follows from retention: the originals are on the operator's volume for as long as the
  instance exists (`PDR-0002`).
