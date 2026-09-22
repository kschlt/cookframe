---
id: "ADR-0032"
title: "A capability grant is kept by the repository under its token's digest, widening ADR-0025 from eight operations to eleven"
status: accepted
date: 2026-09-22
tags: ["persistence", "boundaries", "repository-interface", "shopping", "security"]
supersedes: ["ADR-0025"]
constrained_by: ["PDR-0001"]
related_to: ["ADR-0016", "ADR-0021", "ADR-0026", "ADR-0027", "ADR-0015"]
---

## Context

ADR-0016 made a capability URL **permanent-but-revocable** and gave the reason: Bring keeps the URL
it was handed and fetches it again, server-side, whenever the user reopens the recipe (spike Q6).
An expiring token would break a link Bring legitimately kept. ADR-0026 decided that the machine
serving the URL **stops when idle**. Each record is sound, but they only hold together if a grant
outlives the process that minted it, and until this record none did. `src/server/main.ts` built the
capability store in memory, and `migrations/` had no table for grants.

This was measured, not derived, on a spawned instance (OQ-48). The minted URL answered 200 before
`SIGTERM`. After a restart on the same database, the recipe page answered 200 and the URL answered
404. The failure is silent twice over: Bring's later fetch gets the same bytes as a guessed token
(ADR-0021), and nothing on this side sees the request. The import right after minting still works,
because the machine is awake while the operator uses it. So the loss surfaces only when a user
reopens a list days later, which is the one case the permanent lifetime exists for.

Every in-process proof stayed green throughout. That is the reason the decisive proof here spans
two processes.

## Decision

**A capability grant is kept by the repository, beside the library, under the SHA-256 digest of its
token. The repository interface gains three operations for it, and this record supersedes ADR-0025
on the operation set.** ADR-0025 stays readable in place with its `superseded_by` set. The rule
ADR-0018 established and ADR-0025 carried forward is unchanged: an operation is added only with a
named caller. The caller here is the capability store in `src/shopping/`, which the serving route
reads on every request and which the operator's share routes mint and revoke through.

1. **The added operations.**
   - `storeCapabilityGrant({ tokenDigest, recipeId })` keeps a new grant. It answers `false`,
     without writing anything, when the digest is already held.
   - `resolveCapabilityGrant(tokenDigest)` returns the recipe of an **active** grant, or
     `undefined`.
   - `revokeCapabilityGrant(tokenDigest)` answers whether an active grant was revoked.

   Migration `0003` adds the one table that answers them, and the startup read ADR-0027 requires
   gains a third probe, one per migration-backed area.

2. **The store keeps the token's digest, never the token.** A capability URL is a bearer
   credential, and the database is the one place every URL ever minted sits side by side, in a
   hosted database's backups as much as in its live rows. A digest resolves a presented token and
   cannot be turned back into one, so a leaked row is not a working URL. The digest is taken by the
   capability store **before** the repository is called, so no repository ever receives the secret.
   The digest is unsalted on purpose. A salt defends a low-entropy secret against a table built in
   advance, and this secret is 256 bits from a CSPRNG (ADR-0016), so there is no such table to
   build. A salt would also cost the serving route its one read, because a presented token could no
   longer be looked up by its digest.

3. **Revoked means the row stays, marked revoked.** It is not deleted, carries no revocation
   timestamp, and never expires. ADR-0016 point 5 already decided the substance: revoked secrets are
   retained so that a secret can never be re-minted onto a different recipe. This record decides the
   persistent form, and the kept row is what enforces that point. Its digest stays taken, so minting
   meets a conflict and mints again. Revocation is also final: there is no un-revoke, because a
   token someone believed exposed must never come back reaching a recipe.

4. **A held digest is never overwritten.** Storing a grant is an insert that does nothing on
   conflict, and the answer says which happened. It is one statement, so there is no gap between a
   check and a write in which a second grant for the same digest could land. A conflict sends the
   capability store back to the minter. It never replaces a grant, whether that grant is active or
   revoked.

5. **Unknown and revoked are one answer at the interface.** `resolveCapabilityGrant` filters
   revoked grants in the store, so a revoked grant's recipe id never reaches the process that would
   serve it. No caller can tell the two misses apart and pass the difference on (ADR-0016 point 5,
   ADR-0021).

6. **No grant query beyond these three.** There is no listing, no read by recipe, and no index
   beyond the primary key. The capability store exposes no enumeration (ADR-0016), so none of these
   could have a caller. A store that never evicts is correct at V1's scale, as ADR-0016's
   Consequences already accepted. A retention policy is a later decision and does not change this
   contract.

7. **The in-memory capability store is gone, not kept as a double.** The capability store now holds
   nothing of its own. It mints, takes the digest, and calls the repository, so it is exactly as
   durable as the repository it is given. A test that wants a store which survives nothing builds it
   over the provisional repository, the same way every other test gets an empty store. A second
   implementation that exists only in tests would be one more place for the two to drift apart.

8. **The contract suite carries the operations, and the restart is proved outside it.** The three
   operations are proven in the shared suite that runs against every store (ADR-0025 point 7),
   including the refusal of a revoked digest. That suite cannot see this record's point. A store
   that kept grants in a map on the store object passes every contract proof, and this was measured.
   Durability is therefore proved twice outside the contract:
   - at the store, by a second store object built from the connection string alone;
   - at the process an operator starts, by `main.ts` spawned twice on one database. The second
     process serves the URL and the recipe page alike and still refuses the revoked URL. The first
     process also mints and revokes mid-run, so an instance that read its grants once at startup
     fails.

The widened operation set is therefore:
- `storeSnapshot`, `loadSnapshot`, `appendCanonicalVersion`, `loadLatestCanonical`;
- `listLibrary`, `readTwoRuns`;
- `storeCookingPlan`, `loadCookingPlan`;
- `storeCapabilityGrant`, `resolveCapabilityGrant`, `revokeCapabilityGrant`.

## Consequences

- ADR-0016 and ADR-0026 now hold together. A URL Bring kept reaches its recipe after any number of
  idle stops, until it is revoked, and a revocation survives a restart as reliably as a grant does.
- OQ-48 is closed.
- A copy of the database — a backup, a dump attached to a support request, a hosted provider's
  snapshot — does not hand whoever holds it a set of working capability URLs. Only the token in a
  URL does, and the database never had it.
- **The operator cannot show a URL again.** The token exists once, in the response that minted it.
  A user who lost it mints a new grant, and should revoke the old one if they believe it exposed.
  This is the price of point 2 and is accepted: it is the same property that makes a leaked row
  harmless.
- **Revoking by URL still requires the URL.** A grant can only be revoked by presenting its token.
  An operator who lost a URL and believes it exposed has no way to reach that grant. A
  revoke-everything-for-a-recipe operation would close that. It has no caller today, so this record
  does not add it (point 6). The case is named here so that whoever needs it finds out that nothing
  covers it.
- A grant whose recipe is absent is kept and answers the same 404 as an unknown token, because the
  serving route reads the recipe after the grant (ADR-0021). The table has no foreign key to a
  recipe because nothing could reference one: `recipe_version` is keyed by `(recipe_id, version)`,
  and there is no row per recipe.
- The instance now needs `0003` applied to start at all, and says so by name when it is missing.
  That is ADR-0027's trade, extended by one table.
- The DBQ spike's stores refuse the three operations, as they already refuse ADR-0025's two, for
  the reason ADR-0025 gives: a finished measurement is not extended with unmeasured work.

## Alternatives considered

- **Delete the row on revoke.** Rejected: the digest would become mintable again. The chance of a
  CSPRNG producing the same 256 bits is negligible. The rejection rests on the invariant, not the
  odds: ADR-0016 promises that a revoked secret never reaches a recipe again, and a deleted row
  would make that a matter of probability rather than of the store.
- **Keep a revocation timestamp instead of a flag.** Rejected for now: nothing reads when a grant
  was revoked, and a column no query reads is a commitment every future store must honour, bought
  with nothing. It can be added the day something asks when.
- **Give grants an expiry after all.** Rejected: that reverses ADR-0016 on the very point this
  record exists to keep. The failure being fixed is a link dying that should not have died, so an
  expiry would reintroduce it on a schedule.
- **Store the token in plain text.** Rejected: see point 2. It would cost nothing in code and make
  the database a list of working bearer URLs.
- **A second store, separate from the repository.** An example is a file or a key-value store
  beside the database. Rejected: ADR-0003 requires all persistence to go through the repository,
  and a second store would be a second thing to migrate, back up and start before the port binds.
  It would also be a second place that could be empty when the library is not.
- **Keep the in-memory capability store and add a durable one beside it.** Rejected: see point 7.
  The repository already has a durable and an in-memory implementation, and a second pair would
  duplicate that for one table.
