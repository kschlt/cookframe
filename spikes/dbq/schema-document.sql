-- CFV1-DBQ — the DOCUMENT shape.
--
-- ADR-0003's hypothesis in its plainest form: each layer is one validated JSONB
-- document, and every query traverses it. No column is extracted, on purpose —
-- extracted columns are the *other* half of that hypothesis, and mixing them in
-- here would leave the comparison unable to say which half carried the weight.
--
-- The composite primary key is the append-only invariant the repository
-- interface already carries (ADR-0003: a version is never mutated in place).

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

-- The one index a document shape can offer the library listing without
-- extracting anything: an expression index over the document's title.
create index recipe_version_title on recipe_version ((doc ->> 'title'));
