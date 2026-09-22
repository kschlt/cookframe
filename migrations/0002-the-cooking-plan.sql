-- Cookframe migration 0002 — the derived Cooking Plan (CFV1-SL6, ADR-0025).
--
-- ADR-0025 widened the repository interface by `storeCookingPlan` and
-- `loadCookingPlan`, each with a named caller: the `background` generation hook
-- writes, and the cooking route reads. This file is the one table that answers
-- them, and like `0001` it is the ONLY place that table's shape is declared.
--
-- THE OPERATOR APPLIES THIS, in order, after 0001:
--
--   psql "$DATABASE_URL" -f migrations/0002-the-cooking-plan.sql
--
-- Not idempotent, for the same reason 0001 is not: a second application should
-- stop a human and make them look.

-- The plan for ONE version of one recipe. Derived data, not a third recipe
-- layer: ADR-0023 fixed the derivation as deterministic, so re-deriving a
-- version yields the same document and there is nothing an append would keep.
--
-- Two things are structural here rather than promised:
--
--   * The primary key is `(recipe_id, version)`, so a plan derived from one
--     version cannot be served for another. ADR-0025's whole shape rests on
--     that: the caller never supplies the version — it is read out of the
--     plan's own `derivation.canonicalVersion` — so a stale plan is impossible
--     to file rather than something a caller must remember to check.
--   * The foreign key is what refuses a plan naming a version this database
--     does not hold, in the same statement that would have written it. A stored
--     plan whose recipe version does not exist is an untraceable artefact,
--     which the slice forbids for a plan's contents and forbids no less for the
--     plan itself. The cascade is the other direction of the same fact: a plan
--     cannot outlive the version it was derived from.
create table cooking_plan (
  recipe_id  text  not null,
  version    int   not null check (version >= 1),
  doc        jsonb not null,
  primary key (recipe_id, version),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

-- No index beyond the primary key. The only read is by `(recipe_id, version)`,
-- which the key already answers, and ADR-0015's third commitment is that an
-- extraction or an index is added where a query was measured to need one and
-- nowhere else.
