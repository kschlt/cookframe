-- Cookframe migration 0001 — the durable recipe store (CFV1-PG, ADR-0015).
--
-- ADR-0015 closed OQ-03/OQ-04 on measured evidence: PostgreSQL, validated JSONB
-- documents as the record of truth, plus an extracted projection where a query
-- was measured to need one. This file is that shape, and it is the ONLY place
-- the store's physical schema is declared.
--
-- THE OPERATOR APPLIES THIS, not the program. A process that migrates its own
-- database at startup is a different decision and would need its own record
-- (CFV1-PG Hints). So there is no version table and no runner here: the file is
-- applied once, by hand, against an empty database.
--
--   psql "$DATABASE_URL" -f migrations/0001-the-recipe-store.sql
--
-- It is deliberately NOT idempotent. `create table if not exists` would let a
-- second application pass silently over a database that already holds recipes,
-- which is the one case where a human should be stopped and made to look.

-- A Source Snapshot, whole. `storeSnapshot` is last-write-wins per id, which is
-- an upsert on this primary key.
create table snapshot (
  id   text  primary key,
  doc  jsonb not null
);

-- A Canonical Recipe version, whole. The document is the record of truth
-- (ADR-0015 commitment 1): reading a version reads this column.
--
-- The primary key is what makes the append-only contract structural rather than
-- promised. `appendCanonicalVersion` computes the next ordinal and inserts it;
-- if two writers ever computed the same one, the second gets a unique violation
-- and fails, and neither can overwrite the other's version in place. An append
-- that loses a race is an error a caller sees, never a silent replacement.
create table recipe_version (
  recipe_id  text   not null,
  version    int    not null check (version >= 1),
  doc        jsonb  not null,
  primary key (recipe_id, version)
);

-- THE ONE EXTRACTION (ADR-0015 commitment 3: added where a query was measured
-- to need it, and nowhere else). Query 2, the shopping aggregation over 74
-- ingredient lines, ran 2.02 ms against a pure document shape and 1.08 ms with
-- this projection beside the document.
--
-- It is a cache with a contract, never a second source of truth (commitment 2):
-- it is written in the same transaction as the document it derives from, and
-- dropping it and rebuilding it from the documents alone must change nothing.
-- The cascade is part of that: a row here cannot outlive its document.
create table ingredient (
  recipe_id       text not null,
  version         int  not null,
  group_ordinal   int  not null,
  ordinal         int  not null,
  name            text not null,
  unit            text,
  val_kind        text,
  val_value       double precision,
  val_source_text text,
  source_text     text not null,
  primary key (recipe_id, version, group_ordinal, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

-- The library listing reads the title's own wording out of the document, so the
-- index is on that expression and not on `doc ->> 'title'`. Since PDR-0005 the
-- title is a declared state rather than a string — `{"state":"from_source",
-- "sourceText":…}` or `{"state":"not_in_source"}` — and `doc ->> 'title'` now
-- yields the whole object as text, which is an expression no query asks for.
-- A recipe whose source carried no title indexes as NULL, which is what it is.
create index recipe_version_title on recipe_version ((doc -> 'title' ->> 'sourceText'));

-- The shopping aggregation groups by name and unit, case- and space-folded.
create index ingredient_name on ingredient (lower(btrim(name)), unit);
