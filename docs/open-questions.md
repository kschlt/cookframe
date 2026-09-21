# Open Questions

The single place where Cookframe's open implementation questions are tracked. Each keeps a stable
`OQ-NN` id so a decision record can name the question it closes.

`OQ-01`–`OQ-23` originate in the discovery phase, `OQ-24` onwards were found during implementation,
and `OQ-25`–`OQ-33` are the release-readiness items below. This file is the live register; the
discovery-era wording is kept in [`archive/`](archive/).

| Id | Question | State |
|---|---|---|
| OQ-01 | exact framework/router | closed by ADR-0007 |
| OQ-02 | TypeScript vs. another implementation language if real constraints justify a change | closed by ADR-0002 |
| OQ-03 | database technology | open |
| OQ-04 | JSON vs. relational physical persistence | open |
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
| OQ-18 | exact Bring integration mechanism after spike | open |
| OQ-19 | exact hero-image compression/storage variants | open |
| OQ-20 | exact unit conversion behavior | out of V1 scope |
| OQ-21 | semantic ingredient alias vocabulary | out of V1 scope |
| OQ-22 | Focus Mode | out of V1 scope |
| OQ-23 | sophisticated intermediate-food-state graph | out of V1 scope |
| OQ-24 | capture and normalization: one physical model call or two | closed by ADR-0014 |

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
