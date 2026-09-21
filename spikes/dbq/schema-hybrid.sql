-- CFV1-DBQ — the HYBRID shape: ADR-0003's stated expected outcome.
--
-- "Postgres with validated JSONB documents plus extracted query columns" is what
-- that record called the most likely answer to OQ-03/OQ-04. Measuring only a
-- pure document shape against a fully relational one would leave its actual
-- hypothesis untested, and the two extremes are not what anyone proposed.
--
-- The document stays the record of truth: it is what a version is read from, in
-- full, and what the round trip is checked against. Beside it sits ONE extracted
-- table, holding only what a query needs that traversing the document does
-- badly — the ingredient projection the shopping aggregation groups over.
-- Nothing else is extracted, because nothing else was measured to need it.
--
-- The extraction is derived data, written in the same transaction as the
-- document and never edited independently. It is a cache with a contract, not a
-- second source of truth: dropping and rebuilding it from the documents must be
-- a no-op, which `tests/dbq` asserts.

create table snapshot (
  id   text  primary key,
  doc  jsonb not null
);

create table recipe_version (
  recipe_id  text   not null,
  version    int    not null check (version >= 1),
  doc        jsonb  not null,
  primary key (recipe_id, version)
);

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

create index recipe_version_title on recipe_version ((doc ->> 'title'));
create index hybrid_ingredient_name on ingredient (lower(btrim(name)), unit);
