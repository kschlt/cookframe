-- Cookframe migration 0003 — the capability grant (OQ-48).
--
-- ADR-0016 made a capability URL permanent-but-revocable because Bring keeps
-- the URL and fetches it again later, and ADR-0026 stops the machine when it is
-- idle. Those two records hold together only if a grant outlives the process
-- that minted it, and until this file nothing did: grants lived in a map in
-- memory, and every URL Bring had kept answered 404 after the first idle stop.
-- This is the one table that keeps them, and like `0001` and `0002` it is the
-- ONLY place its shape is declared.
--
-- THE OPERATOR APPLIES THIS, in order, after 0002:
--
--   psql "$DATABASE_URL" -f migrations/0003-the-capability-grant.sql
--
-- Not idempotent, for the same reason 0001 is not: a second application should
-- stop a human and make them look.

-- One grant: the digest of one token, and the one recipe it reaches.
--
-- Three things are structural here rather than promised:
--
--   * The table holds the token's DIGEST, never the token. A capability URL is
--     a bearer credential, and the database is the one place every URL ever
--     minted sits side by side — in a hosted database's backups as much as in
--     its live rows. A digest resolves a presented token and cannot be turned
--     back into one, so a leaked row is not a working URL. The digest is taken
--     outside the store (`src/shopping/capability-token.ts`); nothing on this
--     side of the repository ever sees the secret.
--   * The primary key is the digest, so two grants can never share one. Minting
--     is `insert … on conflict do nothing`, and a conflict sends the minter back
--     for another token rather than overwriting the grant already there.
--   * A revoked grant is KEPT, with `revoked` set, and never deleted (ADR-0016
--     point 5). The row is what makes a revoked token's digest un-mintable, so a
--     secret someone believed exposed can never come back reaching a recipe.
--
-- No foreign key to the recipe. `recipe_version` is keyed by `(recipe_id,
-- version)`, so there is no row a bare recipe id could reference, and a grant
-- whose recipe is absent is already answered: the serving route reads the
-- recipe after the grant and gives the same 404 as an unknown token (ADR-0021).
create table capability_grant (
  token_digest  text     primary key,
  recipe_id     text     not null,
  revoked       boolean  not null default false
);

-- No index beyond the primary key. Every read is by digest, which the key
-- already answers, and ADR-0015's third commitment is that an index is added
-- where a query was measured to need one and nowhere else. There is no read by
-- recipe at all: the store exposes no enumeration (ADR-0016), so nothing could
-- ask one.
