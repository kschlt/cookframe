/**
 * CFV1-DBQ — writing and reading the relational shape.
 *
 * The Canonical Recipe extracted into columns, and read back out of them. Both
 * directions are here on purpose: a shape that can only be written to is not a
 * persistence shape, and the round trip is the honest measure of whether the
 * extraction is complete. `tests/dbq` asserts that what comes back equals what
 * went in, for real recipes — that assertion is what stops this file from
 * quietly dropping a branch of the ontology the queries happen not to read.
 *
 * The length of this file, beside `document-shape.ts`, is a DBQ measurement and
 * not an accident of style.
 */
import type { Client } from "pg"
import type {
  CanonicalRecipe,
  Cue,
  DurationExpression,
  Equipment,
  Ingredient,
  IngredientGroup,
  InstructionSection,
  InstructionStep,
  NutritionStatement,
  RecipeTime,
  RecipeYield,
  SourceRef,
  SourceSnapshot,
  ValueExpression,
} from "../../schema/index.js"
import type { CanonicalVersion } from "../../src/persistence/repository.js"
import type { LoadCost } from "./document-shape.js"

/** Optional keys whose PRESENCE the columns cannot otherwise express. */
const OPTIONAL_KEYS = [
  "authors",
  "sourceClassifications",
  "times",
  "equipment",
  "preparedComponents",
  "nutritionStatements",
  "media",
  "normalizationPromptVersions",
] as const

// --- writing --------------------------------------------------------------

type Row = Record<string, unknown>

/** A `ValueExpression` as its six columns, or six nulls when it is absent. */
function val(v: ValueExpression | undefined): unknown[] {
  return [
    v?.sourceText ?? null,
    v?.kind ?? null,
    v?.value ?? null,
    v?.minValue ?? null,
    v?.maxValue ?? null,
    v?.qualifierText ?? null,
  ]
}

/** A `DurationExpression` as its seven columns. Unit is the extra one. */
function dur(d: DurationExpression): unknown[] {
  return [
    d.sourceText,
    d.kind,
    d.value ?? null,
    d.minValue ?? null,
    d.maxValue ?? null,
    d.unit ?? null,
    d.qualifierText ?? null,
  ]
}

class Writer {
  #inserts = 0
  constructor(private readonly client: Client) {}

  get inserts(): number {
    return this.#inserts
  }

  async insert(table: string, columns: readonly string[], values: readonly unknown[]): Promise<void> {
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ")
    await this.client.query(
      `insert into ${table} (${columns.join(", ")}) values (${placeholders})`,
      values as unknown[],
    )
    this.#inserts += 1
  }

  /** Every `sourceRefs` array goes through here, addressed by its owner's path. */
  async refs(
    recipeId: string,
    version: number,
    ownerPath: string,
    refs: readonly SourceRef[],
  ): Promise<void> {
    for (const [i, r] of refs.entries()) {
      await this.insert(
        "source_ref",
        ["recipe_id", "version", "owner_path", "ordinal", "block_id", "payload_pointer"],
        [recipeId, version, ownerPath, i, r.blockId ?? null, r.payloadPointer ?? null],
      )
    }
  }
}

export async function loadRelational(
  client: Client,
  versions: readonly CanonicalVersion[],
  snapshots: readonly SourceSnapshot[],
): Promise<LoadCost> {
  const started = Date.now()
  const w = new Writer(client)
  for (const s of snapshots) {
    await w.insert("snapshot", ["id", "doc"], [s.id, JSON.stringify(s)])
  }
  for (const v of versions) await writeVersion(w, v)
  return { inserts: w.inserts, ms: Date.now() - started }
}

async function writeVersion(w: Writer, v: CanonicalVersion): Promise<void> {
  const id = v.recipeId
  const n = v.version
  const r = v.recipe
  const present = OPTIONAL_KEYS.filter((k) =>
    k === "normalizationPromptVersions"
      ? r.provenance.normalizationPromptVersions !== undefined
      : (r as Record<string, unknown>)[k] !== undefined,
  )
  const hero = r.media?.heroImage
  await w.insert(
    "recipe_version",
    [
      "recipe_id", "version", "schema_version", "title", "description",
      "source_publisher", "source_name", "source_url",
      "hero_storage_identity", "hero_origin", "hero_original_source_url", "hero_attribution",
      "prov_source_snapshot_id", "prov_source_snapshot_version", "prov_normalization_model",
      "prov_target_ontology_version", "prov_run_id", "present_optional_keys",
    ],
    [
      id, n, r.schemaVersion, r.title, r.description ?? null,
      r.sourcePublisher ?? null, r.sourceName ?? null, r.sourceUrl ?? null,
      hero?.storageIdentity ?? null, hero?.origin ?? null,
      hero?.originalSourceUrl ?? null, hero?.attribution ?? null,
      r.provenance.sourceSnapshotId, r.provenance.sourceSnapshotVersion,
      r.provenance.normalizationModel ?? null,
      r.provenance.targetOntologyVersion, r.provenance.runId, present,
    ],
  )

  for (const [i, a] of (r.authors ?? []).entries()) {
    await w.insert("recipe_author", ["recipe_id", "version", "ordinal", "name"], [id, n, i, a])
  }
  for (const [i, p] of (r.provenance.normalizationPromptVersions ?? []).entries()) {
    await w.insert("prov_prompt_version", ["recipe_id", "version", "ordinal", "value"], [id, n, i, p])
  }

  for (const [i, c] of (r.sourceClassifications ?? []).entries()) {
    const path = `/sourceClassifications/${i}`
    await w.insert(
      "classification",
      ["recipe_id", "version", "ordinal", "path", "kind", "source_text", "normalized_value", "vocabulary", "identifier"],
      [id, n, i, path, c.kind, c.sourceText, c.normalizedValue ?? null, c.vocabulary ?? null, c.identifier ?? null],
    )
    await w.refs(id, n, path, c.sourceRefs)
  }

  for (const [i, y] of r.yields.entries()) {
    const path = `/yields/${i}`
    await w.insert(
      "recipe_yield",
      ["recipe_id", "version", "ordinal", "path", "yield_id", "source_text", "unit", "context_text",
       "scaling_eligibility", "val_source_text", "val_kind", "val_value", "val_min", "val_max", "val_qualifier_text"],
      [id, n, i, path, y.id, y.sourceText, y.unit ?? null, y.contextText ?? null,
       y.scalingEligibility, ...val(y.valueExpression)],
    )
    await w.refs(id, n, path, y.sourceRefs)
  }

  for (const [i, t] of (r.times ?? []).entries()) {
    const path = `/times/${i}`
    await w.insert(
      "recipe_time",
      ["recipe_id", "version", "ordinal", "path", "type", "source_label",
       "dur_source_text", "dur_kind", "dur_value", "dur_min", "dur_max", "dur_unit", "dur_qualifier_text"],
      [id, n, i, path, t.type, t.sourceLabel ?? null, ...dur(t.durationExpression)],
    )
    await w.refs(id, n, path, t.sourceRefs)
  }

  for (const [i, e] of (r.equipment ?? []).entries()) {
    const path = `/equipment/${i}`
    await w.insert(
      "equipment",
      ["recipe_id", "version", "ordinal", "path", "equipment_id", "source_text", "name",
       "val_source_text", "val_kind", "val_value", "val_min", "val_max", "val_qualifier_text"],
      [id, n, i, path, e.id, e.sourceText, e.name, ...val(e.quantityExpression)],
    )
    for (const [j, q] of e.qualifiers.entries()) {
      await w.insert(
        "equipment_qualifier",
        ["recipe_id", "version", "equipment_ordinal", "ordinal", "value"],
        [id, n, i, j, q],
      )
    }
    await w.refs(id, n, path, e.sourceRefs)
  }

  for (const [gi, g] of r.ingredientGroups.entries()) {
    const gpath = `/ingredientGroups/${gi}`
    await w.insert(
      "ingredient_group",
      ["recipe_id", "version", "ordinal", "path", "group_id", "title"],
      [id, n, gi, gpath, g.id, g.title ?? null],
    )
    await w.refs(id, n, gpath, g.sourceRefs)
    for (const [ii, ing] of g.ingredients.entries()) {
      const ipath = `${gpath}/ingredients/${ii}`
      await w.insert(
        "ingredient",
        ["recipe_id", "version", "group_ordinal", "ordinal", "path", "ingredient_id", "source_text",
         "name", "unit", "is_optional", "scaling_eligibility",
         "val_source_text", "val_kind", "val_value", "val_min", "val_max", "val_qualifier_text"],
        [id, n, gi, ii, ipath, ing.id, ing.sourceText, ing.name, ing.unit ?? null,
         ing.optional ?? null, ing.scalingEligibility, ...val(ing.quantityExpression)],
      )
      for (const [qi, q] of ing.qualifiers.entries()) {
        await w.insert(
          "ingredient_qualifier",
          ["recipe_id", "version", "group_ordinal", "ingredient_ordinal", "ordinal", "value"],
          [id, n, gi, ii, qi, q],
        )
      }
      await w.refs(id, n, ipath, ing.sourceRefs)
    }
  }

  for (const [i, c] of (r.preparedComponents ?? []).entries()) {
    const path = `/preparedComponents/${i}`
    await w.insert(
      "prepared_component",
      ["recipe_id", "version", "ordinal", "path", "component_id", "label", "created_by_step_id"],
      [id, n, i, path, c.id, c.label, c.createdByStepId],
    )
    await w.refs(id, n, path, c.sourceRefs)
  }

  for (const [si, s] of r.instructionSections.entries()) {
    const spath = `/instructionSections/${si}`
    await w.insert(
      "instruction_section",
      ["recipe_id", "version", "ordinal", "path", "section_id", "title"],
      [id, n, si, spath, s.id, s.title ?? null],
    )
    await w.refs(id, n, spath, s.sourceRefs)
    for (const [ti, step] of s.steps.entries()) {
      await writeStep(w, id, n, si, ti, `${spath}/steps/${ti}`, step)
    }
  }

  for (const [i, st] of (r.nutritionStatements ?? []).entries()) {
    const path = `/nutritionStatements/${i}`
    await w.insert(
      "nutrition_statement",
      ["recipe_id", "version", "ordinal", "path", "statement_id", "source_text",
       "basis_kind", "basis_yield_ref", "basis_unit", "basis_source_text",
       "basis_val_source_text", "basis_val_kind", "basis_val_value", "basis_val_min",
       "basis_val_max", "basis_val_qualifier_text"],
      [id, n, i, path, st.id, st.sourceText ?? null,
       st.basis.kind, st.basis.yieldRef ?? null, st.basis.unit ?? null, st.basis.sourceText ?? null,
       ...val(st.basis.quantityExpression)],
    )
    await w.refs(id, n, path, st.sourceRefs)
    for (const [fi, f] of st.facts.entries()) {
      const fpath = `${path}/facts/${fi}`
      await w.insert(
        "nutrition_fact",
        ["recipe_id", "version", "statement_ordinal", "ordinal", "path", "nutrient", "source_label",
         "unit", "val_source_text", "val_kind", "val_value", "val_min", "val_max", "val_qualifier_text"],
        [id, n, i, fi, fpath, f.nutrient, f.sourceLabel ?? null, f.unit ?? null, ...val(f.valueExpression)],
      )
      await w.refs(id, n, fpath, f.sourceRefs)
    }
  }
}

async function writeStep(
  w: Writer,
  id: string,
  n: number,
  si: number,
  ti: number,
  path: string,
  step: InstructionStep,
): Promise<void> {
  await w.insert(
    "instruction_step",
    ["recipe_id", "version", "section_ordinal", "ordinal", "path", "step_id", "source_text", "normalized_action_text"],
    [id, n, si, ti, path, step.id, step.sourceText, step.normalizedActionText],
  )
  await w.refs(id, n, path, step.sourceRefs)

  for (const [i, c] of step.producesComponents.entries()) {
    await w.insert(
      "step_produces_component",
      ["recipe_id", "version", "section_ordinal", "step_ordinal", "ordinal", "component_id"],
      [id, n, si, ti, i, c],
    )
  }

  const uses = [
    ...step.ingredientUses.map((u, i) => ({ kind: "ingredient", i, subject: u.ingredientId, u })),
    ...step.componentUses.map((u, i) => ({ kind: "component", i, subject: u.componentId, u })),
  ]
  for (const { kind, i, subject, u } of uses) {
    const upath = `${path}/${kind === "ingredient" ? "ingredientUses" : "componentUses"}/${i}`
    await w.insert(
      "step_use",
      ["recipe_id", "version", "section_ordinal", "step_ordinal", "subject_kind", "ordinal", "path",
       "subject_id", "usage", "unit", "source_text",
       "val_source_text", "val_kind", "val_value", "val_min", "val_max", "val_qualifier_text"],
      [id, n, si, ti, kind, i, upath, subject, u.usage, u.unit ?? null, u.sourceText ?? null,
       ...val(u.quantityExpression)],
    )
    await w.refs(id, n, upath, u.sourceRefs)
  }

  for (const [i, e] of step.equipmentUses.entries()) {
    const epath = `${path}/equipmentUses/${i}`
    await w.insert(
      "step_equipment_use",
      ["recipe_id", "version", "section_ordinal", "step_ordinal", "ordinal", "path", "equipment_id", "source_text"],
      [id, n, si, ti, i, epath, e.equipmentId, e.sourceText ?? null],
    )
    await w.refs(id, n, epath, e.sourceRefs)
  }

  for (const [i, d] of step.durations.entries()) {
    const dpath = `${path}/durations/${i}`
    await w.insert(
      "step_duration",
      ["recipe_id", "version", "section_ordinal", "step_ordinal", "ordinal", "path", "source_label",
       "dur_source_text", "dur_kind", "dur_value", "dur_min", "dur_max", "dur_unit", "dur_qualifier_text"],
      [id, n, si, ti, i, dpath, d.sourceLabel ?? null, ...dur(d.durationExpression)],
    )
    await w.refs(id, n, dpath, d.sourceRefs)
  }

  for (const [i, t] of step.temperatures.entries()) {
    const tpath = `${path}/temperatures/${i}`
    await w.insert(
      "step_temperature",
      ["recipe_id", "version", "section_ordinal", "step_ordinal", "ordinal", "path", "source_text",
       "unit", "context_text", "val_source_text", "val_kind", "val_value", "val_min", "val_max", "val_qualifier_text"],
      [id, n, si, ti, i, tpath, t.sourceText, t.unit ?? null, t.contextText ?? null, ...val(t.valueExpression)],
    )
    await w.refs(id, n, tpath, t.sourceRefs)
  }

  const cues: ReadonlyArray<readonly [string, string, readonly Cue[]]> = [
    ["doneness", "donenessCues", step.donenessCues],
    ["prerequisite", "prerequisiteCues", step.prerequisiteCues],
    ["wait", "waitCues", step.waitCues],
  ]
  for (const [kind, key, list] of cues) {
    for (const [i, c] of list.entries()) {
      const cpath = `${path}/${key}/${i}`
      await w.insert(
        "step_cue",
        ["recipe_id", "version", "section_ordinal", "step_ordinal", "cue_kind", "ordinal", "path", "source_text"],
        [id, n, si, ti, kind, i, cpath, c.sourceText],
      )
      await w.refs(id, n, cpath, c.sourceRefs)
    }
  }
}

// --- reading --------------------------------------------------------------

/** Drop the keys whose value is `undefined`, so a round trip matches the input. */
function compact<T extends Row>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]
  return o
}

function opt<T>(v: T | null): T | undefined {
  return v === null ? undefined : v
}

function valFrom(r: Row, p = "val_"): ValueExpression | undefined {
  if (r[`${p}kind`] === null || r[`${p}kind`] === undefined) return undefined
  return compact({
    sourceText: r[`${p}source_text`] as string,
    kind: r[`${p}kind`] as ValueExpression["kind"],
    value: opt(r[`${p}value`] as number | null),
    minValue: opt(r[`${p}min`] as number | null),
    maxValue: opt(r[`${p}max`] as number | null),
    qualifierText: opt(r[`${p}qualifier_text`] as string | null),
  }) as ValueExpression
}

function durFrom(r: Row, p = "dur_"): DurationExpression {
  return compact({
    sourceText: r[`${p}source_text`] as string,
    kind: r[`${p}kind`] as DurationExpression["kind"],
    value: opt(r[`${p}value`] as number | null),
    minValue: opt(r[`${p}min`] as number | null),
    maxValue: opt(r[`${p}max`] as number | null),
    unit: opt(r[`${p}unit`] as string | null),
    qualifierText: opt(r[`${p}qualifier_text`] as string | null),
  }) as DurationExpression
}

/**
 * Read one version back out of the relational shape as a `CanonicalRecipe`.
 *
 * Twenty-two SELECTs, one per table, assembled in memory — the shape's read
 * path for the one operation `ADR-0003` says a document store is least likely to
 * serve well. Reading refs by owner path is what lets a single query cover every
 * `sourceRefs` array at once.
 */
export async function readRelational(
  client: Client,
  recipeId: string,
  version: number,
): Promise<CanonicalRecipe | undefined> {
  const key = [recipeId, version]
  const q = async (sql: string): Promise<Row[]> => (await client.query(sql, key)).rows as Row[]

  const head = (await q("select * from recipe_version where recipe_id = $1 and version = $2"))[0]
  if (head === undefined) return undefined
  const present = new Set(head.present_optional_keys as string[])

  const refRows = await q(
    "select * from source_ref where recipe_id = $1 and version = $2 order by owner_path, ordinal",
  )
  const refsByPath = new Map<string, SourceRef[]>()
  for (const r of refRows) {
    const list = refsByPath.get(r.owner_path as string) ?? []
    list.push(
      compact({
        blockId: opt(r.block_id as string | null),
        payloadPointer: opt(r.payload_pointer as string | null),
      }) as SourceRef,
    )
    refsByPath.set(r.owner_path as string, list)
  }
  const refs = (path: string): SourceRef[] => refsByPath.get(path) ?? []

  const authors = (await q("select * from recipe_author where recipe_id = $1 and version = $2 order by ordinal"))
    .map((r) => r.name as string)
  const prompts = (await q("select * from prov_prompt_version where recipe_id = $1 and version = $2 order by ordinal"))
    .map((r) => r.value as string)

  const classifications = (
    await q("select * from classification where recipe_id = $1 and version = $2 order by ordinal")
  ).map((r) =>
    compact({
      kind: r.kind,
      sourceText: r.source_text,
      normalizedValue: opt(r.normalized_value as string | null),
      vocabulary: opt(r.vocabulary as string | null),
      identifier: opt(r.identifier as string | null),
      sourceRefs: refs(r.path as string),
    }),
  ) as CanonicalRecipe["sourceClassifications"]

  const yields = (
    await q("select * from recipe_yield where recipe_id = $1 and version = $2 order by ordinal")
  ).map((r) =>
    compact({
      id: r.yield_id,
      sourceText: r.source_text,
      valueExpression: valFrom(r),
      unit: opt(r.unit as string | null),
      contextText: opt(r.context_text as string | null),
      scalingEligibility: r.scaling_eligibility,
      sourceRefs: refs(r.path as string),
    }),
  ) as RecipeYield[]

  const times = (
    await q("select * from recipe_time where recipe_id = $1 and version = $2 order by ordinal")
  ).map((r) =>
    compact({
      type: r.type,
      sourceLabel: opt(r.source_label as string | null),
      durationExpression: durFrom(r),
      sourceRefs: refs(r.path as string),
    }),
  ) as RecipeTime[]

  const equipQualifiers = groupBy(
    await q("select * from equipment_qualifier where recipe_id = $1 and version = $2 order by equipment_ordinal, ordinal"),
    (r) => String(r.equipment_ordinal),
  )
  const equipment = (
    await q("select * from equipment where recipe_id = $1 and version = $2 order by ordinal")
  ).map((r) =>
    compact({
      id: r.equipment_id,
      sourceText: r.source_text,
      name: r.name,
      quantityExpression: valFrom(r),
      qualifiers: (equipQualifiers.get(String(r.ordinal)) ?? []).map((x) => x.value as string),
      sourceRefs: refs(r.path as string),
    }),
  ) as Equipment[]

  const ingQualifiers = groupBy(
    await q("select * from ingredient_qualifier where recipe_id = $1 and version = $2 order by group_ordinal, ingredient_ordinal, ordinal"),
    (r) => `${r.group_ordinal}/${r.ingredient_ordinal}`,
  )
  const ingredients = groupBy(
    await q("select * from ingredient where recipe_id = $1 and version = $2 order by group_ordinal, ordinal"),
    (r) => String(r.group_ordinal),
  )
  const ingredientGroups = (
    await q("select * from ingredient_group where recipe_id = $1 and version = $2 order by ordinal")
  ).map((g) =>
    compact({
      id: g.group_id,
      title: opt(g.title as string | null),
      sourceRefs: refs(g.path as string),
      ingredients: (ingredients.get(String(g.ordinal)) ?? []).map((r) =>
        compact({
          id: r.ingredient_id,
          sourceText: r.source_text,
          quantityExpression: valFrom(r),
          unit: opt(r.unit as string | null),
          name: r.name,
          qualifiers: (ingQualifiers.get(`${r.group_ordinal}/${r.ordinal}`) ?? []).map((x) => x.value as string),
          optional: opt(r.is_optional as boolean | null),
          scalingEligibility: r.scaling_eligibility,
          sourceRefs: refs(r.path as string),
        }),
      ) as Ingredient[],
    }),
  ) as IngredientGroup[]

  const preparedComponents = (
    await q("select * from prepared_component where recipe_id = $1 and version = $2 order by ordinal")
  ).map((r) => ({
    id: r.component_id as string,
    label: r.label as string,
    createdByStepId: r.created_by_step_id as string,
    sourceRefs: refs(r.path as string),
  })) as CanonicalRecipe["preparedComponents"]

  const instructionSections = await readSections(q, refs)

  const facts = groupBy(
    await q("select * from nutrition_fact where recipe_id = $1 and version = $2 order by statement_ordinal, ordinal"),
    (r) => String(r.statement_ordinal),
  )
  const nutritionStatements = (
    await q("select * from nutrition_statement where recipe_id = $1 and version = $2 order by ordinal")
  ).map((r) =>
    compact({
      id: r.statement_id,
      sourceText: opt(r.source_text as string | null),
      basis: compact({
        kind: r.basis_kind,
        yieldRef: opt(r.basis_yield_ref as string | null),
        quantityExpression: valFrom(r, "basis_val_"),
        unit: opt(r.basis_unit as string | null),
        sourceText: opt(r.basis_source_text as string | null),
      }),
      facts: (facts.get(String(r.ordinal)) ?? []).map((f) =>
        compact({
          nutrient: f.nutrient,
          sourceLabel: opt(f.source_label as string | null),
          valueExpression: valFrom(f),
          unit: opt(f.unit as string | null),
          sourceRefs: refs(f.path as string),
        }),
      ),
      sourceRefs: refs(r.path as string),
    }),
  ) as NutritionStatement[]

  const hero =
    head.hero_storage_identity === null
      ? undefined
      : compact({
          storageIdentity: head.hero_storage_identity,
          origin: head.hero_origin,
          originalSourceUrl: opt(head.hero_original_source_url as string | null),
          attribution: opt(head.hero_attribution as string | null),
        })

  return compact({
    id: head.recipe_id,
    schemaVersion: head.schema_version,
    title: head.title,
    description: opt(head.description as string | null),
    authors: present.has("authors") ? authors : undefined,
    sourcePublisher: opt(head.source_publisher as string | null),
    sourceName: opt(head.source_name as string | null),
    sourceUrl: opt(head.source_url as string | null),
    sourceClassifications: present.has("sourceClassifications") ? classifications : undefined,
    yields,
    times: present.has("times") ? times : undefined,
    equipment: present.has("equipment") ? equipment : undefined,
    ingredientGroups,
    preparedComponents: present.has("preparedComponents") ? preparedComponents : undefined,
    instructionSections,
    nutritionStatements: present.has("nutritionStatements") ? nutritionStatements : undefined,
    media: present.has("media") ? compact({ heroImage: hero }) : undefined,
    provenance: compact({
      sourceSnapshotId: head.prov_source_snapshot_id,
      sourceSnapshotVersion: head.prov_source_snapshot_version,
      normalizationModel: opt(head.prov_normalization_model as string | null),
      normalizationPromptVersions: present.has("normalizationPromptVersions") ? prompts : undefined,
      targetOntologyVersion: head.prov_target_ontology_version,
      runId: head.prov_run_id,
    }),
  }) as unknown as CanonicalRecipe
}

async function readSections(
  q: (sql: string) => Promise<Row[]>,
  refs: (path: string) => SourceRef[],
): Promise<InstructionSection[]> {
  const stepKey = (r: Row): string => `${r.section_ordinal}/${r.step_ordinal}`
  const produces = groupBy(
    await q("select * from step_produces_component where recipe_id = $1 and version = $2 order by section_ordinal, step_ordinal, ordinal"),
    stepKey,
  )
  const usesByStep = groupBy(
    await q("select * from step_use where recipe_id = $1 and version = $2 order by section_ordinal, step_ordinal, subject_kind, ordinal"),
    stepKey,
  )
  const equipUses = groupBy(
    await q("select * from step_equipment_use where recipe_id = $1 and version = $2 order by section_ordinal, step_ordinal, ordinal"),
    stepKey,
  )
  const durations = groupBy(
    await q("select * from step_duration where recipe_id = $1 and version = $2 order by section_ordinal, step_ordinal, ordinal"),
    stepKey,
  )
  const temperatures = groupBy(
    await q("select * from step_temperature where recipe_id = $1 and version = $2 order by section_ordinal, step_ordinal, ordinal"),
    stepKey,
  )
  const cues = groupBy(
    await q("select * from step_cue where recipe_id = $1 and version = $2 order by section_ordinal, step_ordinal, cue_kind, ordinal"),
    stepKey,
  )
  const steps = groupBy(
    await q("select * from instruction_step where recipe_id = $1 and version = $2 order by section_ordinal, ordinal"),
    (r) => String(r.section_ordinal),
  )

  const useOf = (r: Row): Row =>
    compact({
      ...(r.subject_kind === "ingredient"
        ? { ingredientId: r.subject_id }
        : { componentId: r.subject_id }),
      usage: r.usage,
      quantityExpression: valFrom(r),
      unit: opt(r.unit as string | null),
      sourceText: opt(r.source_text as string | null),
      sourceRefs: refs(r.path as string),
    })

  const cueOf = (r: Row): Cue => ({ sourceText: r.source_text as string, sourceRefs: refs(r.path as string) })

  return (
    await q("select * from instruction_section where recipe_id = $1 and version = $2 order by ordinal")
  ).map((s) =>
    compact({
      id: s.section_id,
      title: opt(s.title as string | null),
      sourceRefs: refs(s.path as string),
      steps: (steps.get(String(s.ordinal)) ?? []).map((t) => {
        const k = `${t.section_ordinal}/${t.ordinal}`
        const mine = usesByStep.get(k) ?? []
        const stepCues = cues.get(k) ?? []
        return {
          id: t.step_id as string,
          sourceText: t.source_text as string,
          normalizedActionText: t.normalized_action_text as string,
          sourceRefs: refs(t.path as string),
          ingredientUses: mine.filter((u) => u.subject_kind === "ingredient").map(useOf),
          componentUses: mine.filter((u) => u.subject_kind === "component").map(useOf),
          equipmentUses: (equipUses.get(k) ?? []).map((e) =>
            compact({
              equipmentId: e.equipment_id,
              sourceText: opt(e.source_text as string | null),
              sourceRefs: refs(e.path as string),
            }),
          ),
          producesComponents: (produces.get(k) ?? []).map((p) => p.component_id as string),
          durations: (durations.get(k) ?? []).map((d) =>
            compact({
              durationExpression: durFrom(d),
              sourceLabel: opt(d.source_label as string | null),
              sourceRefs: refs(d.path as string),
            }),
          ),
          temperatures: (temperatures.get(k) ?? []).map((x) =>
            compact({
              sourceText: x.source_text,
              valueExpression: valFrom(x),
              unit: opt(x.unit as string | null),
              contextText: opt(x.context_text as string | null),
              sourceRefs: refs(x.path as string),
            }),
          ),
          donenessCues: stepCues.filter((c) => c.cue_kind === "doneness").map(cueOf),
          prerequisiteCues: stepCues.filter((c) => c.cue_kind === "prerequisite").map(cueOf),
          waitCues: stepCues.filter((c) => c.cue_kind === "wait").map(cueOf),
        } as unknown as InstructionStep
      }),
    }),
  ) as InstructionSection[]
}

function groupBy(rows: readonly Row[], key: (r: Row) => string): Map<string, Row[]> {
  const out = new Map<string, Row[]>()
  for (const r of rows) {
    const k = key(r)
    const list = out.get(k) ?? []
    list.push(r)
    out.set(k, list)
  }
  return out
}
