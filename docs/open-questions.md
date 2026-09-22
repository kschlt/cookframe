# Open Questions

The single place where Cookframe's open implementation questions are tracked. Each keeps a stable
`OQ-NN` id so a decision record can name the question it closes.

`OQ-01`–`OQ-23` originate in the discovery phase, `OQ-24` onwards were found during implementation,
and `OQ-25`–`OQ-33` are the release-readiness items below. `OQ-25a` is lettered because `OQ-25`
onwards were already taken by the release-readiness block; an id is never reused or renumbered, and
`tests/records/` fails the build if two rows claim one id. That rule reads the first column of a
table row; naming an id in prose, here or in a record, is a citation and not a claim. This file is the live register; the
discovery-era wording is kept in [`archive/`](archive/).

| Id | Question | State |
|---|---|---|
| OQ-01 | exact framework/router | closed by ADR-0007 |
| OQ-02 | TypeScript vs. another implementation language if real constraints justify a change | closed by ADR-0002 |
| OQ-03 | database technology | closed by ADR-0015 (PostgreSQL) |
| OQ-04 | JSON vs. relational physical persistence | closed by ADR-0015 (JSONB documents, extracted projections where measured) |
| OQ-05 | hosting platform/reference deployment | closed by ADR-0011 (rented single-tenant cloud server). **ADR-0026 is proposed to supersede it** — a scale-to-zero machine, a sleeping managed Postgres, a persistent volume — and is not accepted, because whether `PDR-0002` binds the maintainer's own instance or only what the product documents as self-hosting is a product question that has to be answered first. Until it is, ADR-0011 stands |
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
| OQ-38 | whether the committed Shortcut definition imports and runs on a device | open — `shortcut/Capture Recipe.plist` is the source of truth `PDR-0003` asks for, and it is checked here for the two properties that can be checked here: it parses as a property list, and it carries no credential and no instance identifier (`slice5/shortcut-definition-committed-and-clean`). Whether Shortcuts **accepts** it and the flow runs end to end is unverified: no iOS device is reachable from the environment it was written in, so its action identifiers and parameter shapes are taken from the documented format rather than from a successful import. A client nobody can install is the failure `PDR-0003` was written to avoid, so this is registered rather than assumed. One import on one device closes it |
| OQ-39 | whether a required field with no source value may be filled | **closed by PDR-0005** — it may not: it stays empty and carries an explicit `not_in_source` state. Found by the real-photograph run (`spikes/s1-photo-gate/VERDICT.md`, finding 3), where a titleless handwritten card was stored titled with the full text of its own first instruction. `title` was the only required content field on the contract with neither `sourceText` nor `sourceRefs`, so no check could see it; the enumeration is `tests/schema/required-fields.contract.test.ts` |
| OQ-40 | may a canonical recipe carry an ingredient list its source does not have | open — the same run derived a complete ingredient list from method prose on a card that had none (finding 2). Nothing was invented, every item is named in the method, but the capture prompt says "do not add" and omission-over-coercion points the same way, while a cook shopping for the recipe plainly wants the list. Same root cause as OQ-39 — the contract asks for structure the source does not have — but the answer does not follow from it: an empty `ingredientGroups` is already expressible, so this is a question about whether derivation is permitted and how it would be marked, not about a field that cannot say nothing. Needs a maintainer decision |
| OQ-41 | how a multi-recipe refusal should count recipes when the frame holds more than the source | open — measured 2026-09-22 in `spikes/sl5-scan-to-shop/RESULT.md`: three of eleven photographs were refused as `multiple_recipes`, and only one of them holds several recipes (the four-recipe spread `CFV1-MR1` was built for). The other two are a single recipe facing a photograph of several finished dishes, and a single card lying on other printed recipe sheets whose edges are in frame. The count is taken from what is in the shot rather than from what is being captured, and on a phone something else is almost always in the shot. `CFV1-MR1`'s refusal is doing what it was built to do and `CFV1-SL5` delivers it to the person correctly; what nobody has decided is what a recipe in a photograph IS for the purpose of counting. That is a product boundary with a precision/recall trade-off behind it — refusing a page that holds two recipes protects against silent loss, refusing a page that holds one costs a capture — so it needs a maintainer decision rather than a prompt adjustment made after seeing a rate |
| OQ-42 | how an operator reads their own library from a browser | open — `ADR-0024` requires the library credential on every page and answers a caller without it with the same bytes as a recipe that does not exist, because a `401` beside a `404` is an enumeration oracle for the private library. A browser sends no bearer token by itself, so reading one's own library today means a client that sets a header, and an operator who forgets the credential is told "Not Found". Every obvious fix is a credential in a new place with a new lifetime: a cookie needs a session, a query parameter puts the secret in logs and history, and basic auth reopens the "this address exists" answer. `PDR-0002` keeps the instance single-user and `ADR-0011` leaves the multi-user library open, so whoever decides this decides both. Needs a maintainer decision |
| OQ-43 | when the library listing stops being one read per recipe | open — the listing route loads each row's latest canonical after `listLibrary`, because a card needs the whole recipe (hero image, attribution, `PDR-0005`'s title state) and the listing row carries three fields. That is an N+1 by construction, entered deliberately rather than overlooked: the alternative is a listing projection, which is a store decision (`ADR-0015` chose "an extracted projection where a query is measured to need one", and `OQ-25a` is about what earns the next one). Against the provisional in-memory store the cost is not measurable; against a database that may itself be asleep it will be. Nobody has measured it, so no bar is stated here — what is registered is that the read is known, not accidental, and that `OQ-25a`'s unanswered threshold is what a measurement would be scored against |
| OQ-44 | whether the safe-fetch connector behaves identically on the deployment platform | open — `ADR-0010`'s guard is a custom `undici` connector, and that record names it "the one place the codebase is not portable in the sense `ADR-0001` means". `ADR-0026` (proposed) deploys onto a Linux container, which is the environment the guard was written for, so it is expected to be intact — but expected is not measured, and the URL import is not optional. What has to be shown on the real platform is that `tests/url-fetch/` passes there unchanged, in particular that resolution happens inside the connector and the connection is pinned to the validated address; a platform that silently proxies egress would pass a naive check and fail this one. Until it is run, `ADR-0026`'s viability rests on an assumption |
| OQ-45 | how long Bring waits for a capability URL that has to start a stopped machine | open — `ADR-0017` has Bring fetch the recipe server-side and `ADR-0026` (proposed) lets the machine stop when idle, so a first fetch after an idle period pays a cold start Bring never had to wait for under `ADR-0011`. Bring's timeout is not documented to us and cannot be derived; a handoff that fails this way fails silently, because nothing in our code sees the abandoned request. One real import against a stopped instance answers it. If the answer is that it does not wait, the fix is a minimum running instance or a separate serving path — both of which cost the idle saving `ADR-0026` exists for, so this is the question most likely to reopen that record |
| OQ-46 | what the instance actually needs to run: memory, start-up time, and the real monthly cost | open — `ADR-0026` (proposed) is written against third-party figures supplied on 2026-09-22 (a 512 MiB machine, per-second billing, a per-GB volume price) and against no measurement of ours. Nothing has ever been deployed: there is no production image, no entry point and no `start` script, so image size, resident memory, cold-start time and the frequency with which the platform actually stops the machine are all unknown. The record's reasoning depends on the magnitude, not the figures, so this does not block it — but the first month's real numbers are what turn "low single-digit dollars" from a quotation into a fact |

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
