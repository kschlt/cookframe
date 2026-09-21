-- CFV1-DBQ — the RELATIONAL shape.
--
-- The full Canonical Recipe extracted into columns: every field of every node of
-- the ontology, so that a recipe read back out of these tables is the recipe that
-- went in. A partial extraction would make the comparison dishonest — a shape
-- that only stores what the three queries touch cannot serve the fourth query,
-- and "read two runs side by side" is a query over the WHOLE recipe.
--
-- Two conventions carry the ontology's shape into tables:
--
-- * `path` is the node's JSON Pointer inside the recipe (`/ingredientGroups/0/
--   ingredients/3`). Ordinals give the ordering the ontology depends on; `path`
--   gives every node one address. It exists because `sourceRefs` hang off nearly
--   every node in the contract, and a polymorphic reference needs an address
--   whose arity does not change from one owner to the next. This is a concession
--   the ontology forces on a relational shape, and DBQ counts it as one.
-- * A `ValueExpression` and a `DurationExpression` are inlined as a column group
--   (`*_kind`, `*_value`, `*_min`, `*_max`, `*_source_text`, …) rather than given
--   a table of their own. They are value objects with no identity; a join per
--   quantity would cost more than it buys.
--
-- Every child table cascades from `recipe_version`, so a version is one
-- transactional unit in both shapes.

create table recipe_version (
  recipe_id                  text not null,
  version                    int  not null check (version >= 1),
  schema_version             text not null,
  title                      text not null,
  description                text,
  source_publisher           text,
  source_name                text,
  source_url                 text,
  -- §7 media.heroImage, flattened: at most one, four scalar fields.
  hero_storage_identity      text,
  hero_origin                text,
  hero_original_source_url   text,
  hero_attribution           text,
  -- §4 provenance, flattened: exactly one, never absent.
  prov_source_snapshot_id       text not null,
  prov_source_snapshot_version  int  not null,
  prov_normalization_model      text,
  prov_target_ontology_version  text not null,
  prov_run_id                   text not null,
  -- Which optional keys were PRESENT (an empty array, or an empty `media`) as
  -- opposed to absent. The contract distinguishes the two, and a round trip
  -- that cannot tell them apart is lossy.
  present_optional_keys      text[] not null default '{}',
  primary key (recipe_id, version)
);

create table recipe_author (
  recipe_id text not null, version int not null,
  ordinal   int  not null,
  name      text not null,
  primary key (recipe_id, version, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

create table prov_prompt_version (
  recipe_id text not null, version int not null,
  ordinal   int  not null,
  value     text not null,
  primary key (recipe_id, version, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

create table classification (
  recipe_id text not null, version int not null,
  ordinal          int  not null,
  path             text not null,
  kind             text not null,
  source_text      text not null,
  normalized_value text,
  vocabulary       text,
  identifier       text,
  primary key (recipe_id, version, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

create table recipe_yield (
  recipe_id text not null, version int not null,
  ordinal   int  not null,
  path      text not null,
  yield_id  text not null,
  source_text          text not null,
  unit                 text,
  context_text         text,
  scaling_eligibility  text not null,
  val_source_text      text not null,
  val_kind             text not null,
  val_value            double precision,
  val_min              double precision,
  val_max              double precision,
  val_qualifier_text   text,
  primary key (recipe_id, version, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

create table recipe_time (
  recipe_id text not null, version int not null,
  ordinal      int  not null,
  path         text not null,
  type         text not null,
  source_label text,
  dur_source_text    text not null,
  dur_kind           text not null,
  dur_value          double precision,
  dur_min            double precision,
  dur_max            double precision,
  dur_unit           text,
  dur_qualifier_text text,
  primary key (recipe_id, version, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

create table equipment (
  recipe_id text not null, version int not null,
  ordinal      int  not null,
  path         text not null,
  equipment_id text not null,
  source_text  text not null,
  name         text not null,
  -- quantityExpression is optional here, so its presence is `val_kind is not null`.
  val_source_text    text,
  val_kind           text,
  val_value          double precision,
  val_min            double precision,
  val_max            double precision,
  val_qualifier_text text,
  primary key (recipe_id, version, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

create table equipment_qualifier (
  recipe_id text not null, version int not null,
  equipment_ordinal int not null,
  ordinal           int not null,
  value             text not null,
  primary key (recipe_id, version, equipment_ordinal, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

create table ingredient_group (
  recipe_id text not null, version int not null,
  ordinal  int  not null,
  path     text not null,
  group_id text not null,
  title    text,
  primary key (recipe_id, version, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

create table ingredient (
  recipe_id text not null, version int not null,
  group_ordinal int not null,
  ordinal       int not null,
  path          text not null,
  ingredient_id text not null,
  source_text   text not null,
  name          text not null,
  unit          text,
  -- `optional` is tri-state in the contract: true, false, or absent.
  is_optional         boolean,
  scaling_eligibility text not null,
  val_source_text    text,
  val_kind           text,
  val_value          double precision,
  val_min            double precision,
  val_max            double precision,
  val_qualifier_text text,
  primary key (recipe_id, version, group_ordinal, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

create table ingredient_qualifier (
  recipe_id text not null, version int not null,
  group_ordinal      int not null,
  ingredient_ordinal int not null,
  ordinal            int not null,
  value              text not null,
  primary key (recipe_id, version, group_ordinal, ingredient_ordinal, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

create table prepared_component (
  recipe_id text not null, version int not null,
  ordinal            int  not null,
  path               text not null,
  component_id       text not null,
  label              text not null,
  created_by_step_id text not null,
  primary key (recipe_id, version, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

create table instruction_section (
  recipe_id text not null, version int not null,
  ordinal    int  not null,
  path       text not null,
  section_id text not null,
  title      text,
  primary key (recipe_id, version, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

create table instruction_step (
  recipe_id text not null, version int not null,
  section_ordinal int not null,
  ordinal         int not null,
  path            text not null,
  step_id         text not null,
  source_text            text not null,
  normalized_action_text text not null,
  primary key (recipe_id, version, section_ordinal, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

create table step_produces_component (
  recipe_id text not null, version int not null,
  section_ordinal int not null, step_ordinal int not null,
  ordinal         int  not null,
  component_id    text not null,
  primary key (recipe_id, version, section_ordinal, step_ordinal, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

-- ingredientUses and componentUses differ only in which id they name, so they
-- share a table with a `subject_kind` discriminator. equipmentUses carry no
-- quantity and no usage kind, so they do not.
create table step_use (
  recipe_id text not null, version int not null,
  section_ordinal int not null, step_ordinal int not null,
  subject_kind text not null check (subject_kind in ('ingredient', 'component')),
  ordinal      int  not null,
  path         text not null,
  subject_id   text not null,
  usage        text not null,
  unit         text,
  source_text  text,
  val_source_text    text,
  val_kind           text,
  val_value          double precision,
  val_min            double precision,
  val_max            double precision,
  val_qualifier_text text,
  primary key (recipe_id, version, section_ordinal, step_ordinal, subject_kind, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

create table step_equipment_use (
  recipe_id text not null, version int not null,
  section_ordinal int not null, step_ordinal int not null,
  ordinal      int  not null,
  path         text not null,
  equipment_id text not null,
  source_text  text,
  primary key (recipe_id, version, section_ordinal, step_ordinal, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

create table step_duration (
  recipe_id text not null, version int not null,
  section_ordinal int not null, step_ordinal int not null,
  ordinal      int  not null,
  path         text not null,
  source_label text,
  dur_source_text    text not null,
  dur_kind           text not null,
  dur_value          double precision,
  dur_min            double precision,
  dur_max            double precision,
  dur_unit           text,
  dur_qualifier_text text,
  primary key (recipe_id, version, section_ordinal, step_ordinal, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

create table step_temperature (
  recipe_id text not null, version int not null,
  section_ordinal int not null, step_ordinal int not null,
  ordinal      int  not null,
  path         text not null,
  source_text  text not null,
  unit         text,
  context_text text,
  val_source_text    text not null,
  val_kind           text not null,
  val_value          double precision,
  val_min            double precision,
  val_max            double precision,
  val_qualifier_text text,
  primary key (recipe_id, version, section_ordinal, step_ordinal, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

-- donenessCues, prerequisiteCues and waitCues are the same shape three times.
create table step_cue (
  recipe_id text not null, version int not null,
  section_ordinal int not null, step_ordinal int not null,
  cue_kind text not null check (cue_kind in ('doneness', 'prerequisite', 'wait')),
  ordinal     int  not null,
  path        text not null,
  source_text text not null,
  primary key (recipe_id, version, section_ordinal, step_ordinal, cue_kind, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

create table nutrition_statement (
  recipe_id text not null, version int not null,
  ordinal      int  not null,
  path         text not null,
  statement_id text not null,
  source_text  text,
  basis_kind         text not null,
  basis_yield_ref    text,
  basis_unit         text,
  basis_source_text  text,
  basis_val_source_text    text,
  basis_val_kind           text,
  basis_val_value          double precision,
  basis_val_min            double precision,
  basis_val_max            double precision,
  basis_val_qualifier_text text,
  primary key (recipe_id, version, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

create table nutrition_fact (
  recipe_id text not null, version int not null,
  statement_ordinal int not null,
  ordinal           int not null,
  path              text not null,
  nutrient     text not null,
  source_label text,
  unit         text,
  val_source_text    text not null,
  val_kind           text not null,
  val_value          double precision,
  val_min            double precision,
  val_max            double precision,
  val_qualifier_text text,
  primary key (recipe_id, version, statement_ordinal, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

-- Every `sourceRefs` array in the contract, in one polymorphic table addressed
-- by the owner's JSON Pointer. Fourteen node types carry them; fourteen link
-- tables would be the alternative.
create table source_ref (
  recipe_id text not null, version int not null,
  owner_path      text not null,
  ordinal         int  not null,
  block_id        text,
  payload_pointer text,
  primary key (recipe_id, version, owner_path, ordinal),
  foreign key (recipe_id, version) references recipe_version on delete cascade
);

-- The snapshot is NOT extracted. It is Layer A — source-faithful capture, read
-- whole or not at all — and no query in scope reaches inside it. Extracting it
-- would add tables that answer nothing.
create table snapshot (
  id  text  primary key,
  doc jsonb not null
);

create index ingredient_name_idx on ingredient (name);
create index recipe_version_title_idx on recipe_version (title);
