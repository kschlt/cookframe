# Open Questions

The single place where Cookframe's open implementation questions are tracked. Each keeps a stable
`OQ-NN` id so a decision record can name the question it closes.

`OQ-01`–`OQ-23` originate in the discovery phase, `OQ-24` onwards were found during implementation,
and `OQ-25`–`OQ-33` are the release-readiness items below. `OQ-25a` is lettered because `OQ-25`
onwards were already taken by the release-readiness block; an id is never reused or renumbered. This file is the live register; the
discovery-era wording is kept in [`archive/`](archive/).

| Id | Question | State |
|---|---|---|
| OQ-01 | exact framework/router | closed by ADR-0007 |
| OQ-02 | TypeScript vs. another implementation language if real constraints justify a change | closed by ADR-0002 |
| OQ-03 | database technology | closed by ADR-0015 (PostgreSQL) |
| OQ-04 | JSON vs. relational physical persistence | closed by ADR-0015 (JSONB documents, extracted projections where measured) |
| OQ-05 | hosting platform/reference deployment | closed by ADR-0011 (rented single-tenant cloud server) |
| OQ-06 | object/blob storage implementation | closed by ADR-0009 |
| OQ-07 | model provider | open — configuration, not a record (ADR-0004) |
| OQ-08 | model SDK/library | open — configuration, not a record (ADR-0004) |
| OQ-09 | exact provider adapter interfaces | closed by ADR-0004 |
| OQ-10 | background-job mechanism | closed by ADR-0008 |
| OQ-11 | exact shortcut packaging/distribution mechanism | closed by PDR-0003 |
| OQ-12 | exact mobile component/layout system | open |
| OQ-13 | eager vs. background vs. lazy Cooking Plan generation | closed by PDR-0004 |
| OQ-14 | exact capture-eval thresholds | open — Gate A run on real photographs returned **FAIL** and scan deletion stays disabled (`spikes/s1-photo-gate/VERDICT.md`); the run also showed exact-name matching to be under-specified for real sources, so the thresholds themselves need a maintainer decision |
| OQ-15 | exact scaling-classification algorithm | out of V1 scope |
| OQ-16 | exact safe URL-fetch implementation | closed by ADR-0010 |
| OQ-17 | exact capability-token format/lifetime/revocation mechanism | closed by ADR-0016 (256-bit base64url secret in the URL path, one recipe per token, permanent-but-revocable — revocation the only end) |
| OQ-18 | exact Bring integration mechanism after spike | closed by ADR-0017 (server-side pull of a Schema.org/Recipe page at the capability URL — no Bring API/push; omit-never-invent mapping served verbatim, one canonical yield as base) |
| OQ-19 | exact hero-image compression/storage variants | open |
| OQ-20 | exact unit conversion behavior | out of V1 scope |
| OQ-21 | semantic ingredient alias vocabulary | out of V1 scope |
| OQ-22 | Focus Mode | out of V1 scope |
| OQ-23 | sophisticated intermediate-food-state graph | out of V1 scope |
| OQ-24 | capture and normalization: one physical model call or two | closed by ADR-0014 |
| OQ-25a | what measurement justifies a SECOND extracted projection | open — ADR-0015 chose "JSONB documents plus an extracted projection where a query is measured to need one" and added exactly one, the ingredient projection. It does not say what a later query would have to measure to earn another, so the next person deciding has the precedent but not the bar. Naming it needs a maintainer decision, because it is a threshold and must be fixed before a candidate query is scored against it |
| OQ-34 | how far ADR-0015's "445 of 2079 leaves differ (21%)" understates the real figure | open — the figure was measured with a comparator that compared leaves as `String(value)`, so `4` against `"4"`, `null` against `"null"` and `true` against `"true"` all counted as no difference. It is therefore a **lower bound**, and ADR-0015 is not rewritten to say so. The comparator is fixed (`spikes/dbq/queries.ts`, proved in `tests/dbq/diff.test.ts`), but the 21% has not been re-measured against it, so how loose the bound is nobody knows. It does not affect ADR-0015's shape comparison — all three shapes ran the identical diff — and the conclusion the record draws from it, that the comparison query is not a formality, only gets stronger if the true figure is higher |
| OQ-35 | whether ADR-0015's query-1 latency is comparable with a later run's | open — ADR-0015's "1 library list" row was measured when `listLibrary` selected its SQL by shape but read whatever the session's `search_path` already pointed at. It now sets the path itself, so the timed region carries a `set search_path` round-trip that the recorded figure does not, and the statements column moves from 1 to 2. The record is not rewritten. A future run's query-1 time is therefore **not comparable** with the recorded one, and nobody has measured the difference. Query 2 is unaffected — `shoppingRequirements` set the path from the start — and the shape comparison is unaffected, because all three shapes pay the same round-trip |
| OQ-36 | whether a split amount the source never divides is salient enough at the stove | open — Spaghetti alla Nerano's unit 6 stirs part of 5.3 oz Provolone in and sprinkles the rest on top, and the source recipe never says how much. Both S4 layouts render `part of 5.3 oz` and both carry the reserve line, so neither loses the cue, but the real-device pass did not report whether reading it is enough to hold the rest back (`spikes/s4-cooking-ux/README.md`, finding 1). Inventing a division is not an option, so the choice is between the present cue and asking the cook |
| OQ-37 | whether `assumedAtHand` suppression can hide a DERIVED readiness step | open — S4 reported the two halves separately and could answer neither. Its prototype strikes at-hand ingredient rows through rather than removing them and never touches START NOW, so no readiness step could disappear by construction; the half that matters is a Cooking Plan whose readiness steps are derived (`spikes/s4-cooking-ux/README.md`, finding 2). Until it is answered, suppression ships OFF by default, because turning it on later costs only the answer while shipping it on can drop a step silently |

## Release readiness

These do not block implementation, but must be resolved before Cookframe is presented as a generally
usable self-hosted project.

| Id | Question | State |
|---|---|---|
| OQ-25 | final self-hosting instructions | open |
| OQ-26 | configuration/secrets documentation | open |
| OQ-27 | data export/backup contract | open |
| OQ-28 | public fixture licensing/provenance | open |
| OQ-29 | contributor guidance | open |
| OQ-30 | dependency/third-party attribution | open |
| OQ-31 | security reporting process | open |
| OQ-32 | product/repository description polish | open |
| OQ-33 | name/domain/package collision check if broader distribution requires it | open |

## Closing a question

A question is closed by a decision record, by evidence from a spike, or by being ruled out of scope.
When it closes, update its state here and name what closed it.
