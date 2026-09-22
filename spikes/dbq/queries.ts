/**
 * CFV1-DBQ — the three deciding queries.
 *
 * `ADR-0003` named them and said what they are for: "write the three hardest
 * queries — the library list, total ingredient requirements for shopping, and
 * side-by-side comparison of two normalization runs — against both a document
 * and a relational shape, and compare".
 *
 * Query 1 lives in `stores.ts`, because it is one of the five repository
 * operations. Queries 2 and 3 are here, and they are here for different reasons:
 *
 * * **Shopping (2)** has no operation in the interface at all. It is the one the
 *   interface has to grow for, and it is written as SQL per shape because that
 *   is where the shapes actually differ.
 * * **Run comparison (3)** is expressed over the interface's `readTwoRuns`, so
 *   it is the SAME code for both shapes by construction. What differs is what
 *   each shape has to do to hand over two whole recipes — which is the real
 *   question, and the reason it is measured rather than written twice.
 */
import type { Client } from "pg"
import { assertShape } from "./db.js"
import type { CanonicalRecipe } from "../../schema/index.js"
import type { RecipeRepository } from "../../src/persistence/repository.js"

// --- QUERY 2: total ingredient requirements for shopping ------------------

/**
 * One line of a shopping list: everything the library asks for under one
 * ingredient name and unit.
 *
 * `summedValue` sums ONLY the quantities the source stated exactly. A range, an
 * approximation, a minimum, a "to taste" or a missing quantity is never turned
 * into a number — it is carried out in the source's own wording under
 * `unsummable`, for a human to read. That rule is the contract's (`§5.2`: source
 * wording is retained, non-scalar forms are never coerced), and it is the reason
 * this query is hard in any shape: the interesting part of a quantity is nested
 * two levels below the ingredient and is frequently not a number.
 */
export interface ShoppingLine {
  readonly ingredient: string
  readonly unit: string
  readonly recipeCount: number
  readonly exactCount: number
  readonly summedValue: number | null
  readonly unsummableCount: number
  readonly unsummable: readonly string[]
}

const SHOPPING_PROJECTION = `
  select
    lower(btrim(name))                                             as ingredient,
    coalesce(unit, '')                                             as unit,
    recipe_id,
    kind,
    case when kind = 'exact' then value end                        as exact_value,
    case when kind is distinct from 'exact'
         then coalesce(nullif(btrim(qty_source_text), ''), source_text)
    end                                                            as unsummable_text
  from ingredients`

const SHOPPING_AGGREGATE = `
  select
    ingredient,
    unit,
    count(distinct recipe_id)::int                                   as "recipeCount",
    count(exact_value)::int                                          as "exactCount",
    sum(exact_value)                                                 as "summedValue",
    count(unsummable_text)::int                                      as "unsummableCount",
    coalesce(array_agg(unsummable_text order by unsummable_text)
             filter (where unsummable_text is not null), '{}')        as unsummable
  from projected
  group by ingredient, unit
  order by ingredient, unit`

/**
 * The same result set, once per shape. The two statements must return exactly
 * the same rows over the same data — `tests/dbq` asserts that, which is what
 * makes a difference in *cost* between them meaningful rather than a difference
 * in what they answer.
 */
/**
 * The shopping query over an extracted `ingredient` table.
 *
 * Used by BOTH the hybrid and the relational shape — see the note at their
 * entries in {@link SHOPPING_SQL}.
 */
const EXTRACTED_SHOPPING_SQL = `
    with latest as (
      select distinct on (recipe_id) recipe_id, version
      from recipe_version
      order by recipe_id, version desc
    ),
    ingredients as (
      select
        i.recipe_id,
        i.name,
        i.unit,
        i.val_kind        as kind,
        i.val_value       as value,
        i.val_source_text as qty_source_text,
        i.source_text
      from ingredient i
      join latest l on l.recipe_id = i.recipe_id and l.version = i.version
    ),
    projected as (${SHOPPING_PROJECTION})
    ${SHOPPING_AGGREGATE}`

export const SHOPPING_SQL: Record<string, string> = {
  // The `latest` CTE selects IDENTIFIERS and joins the document back, rather
  // than carrying `doc` as a column. That is not style. Carrying a ~20 KB jsonb
  // through the CTE into the aggregation cost 218 ms on this corpus against
  // 1.5 ms for the form below — a 140x difference that is the planner handling
  // a wide column, not the document shape being slow. Measured 2026-09-21; the
  // first version of this query had it the other way round and would have made
  // the document shape look two orders of magnitude worse than it is.
  document: `
    with latest as (
      select distinct on (recipe_id) recipe_id, version
      from recipe_version
      order by recipe_id, version desc
    ),
    ingredients as (
      select
        l.recipe_id,
        i ->> 'name'                                            as name,
        i ->> 'unit'                                            as unit,
        i -> 'quantityExpression' ->> 'kind'                    as kind,
        (i -> 'quantityExpression' ->> 'value')::double precision as value,
        i -> 'quantityExpression' ->> 'sourceText'              as qty_source_text,
        i ->> 'sourceText'                                      as source_text
      from latest l
      join recipe_version v on v.recipe_id = l.recipe_id and v.version = l.version
      cross join lateral jsonb_array_elements(v.doc -> 'ingredientGroups') g
      cross join lateral jsonb_array_elements(g -> 'ingredients') i
    ),
    projected as (${SHOPPING_PROJECTION})
    ${SHOPPING_AGGREGATE}`,
  // The hybrid and the relational shape run the SAME shopping query, from one
  // constant rather than two copies. That is a RESULT, not a tidy-up.
  //
  // For this query the two shapes have converged: the hybrid's extracted
  // ingredient projection is, in the columns this aggregation reads, the
  // relational shape's `ingredient` table. So the shopping row of ADR-0015's
  // table (1.08 ms against 1.11 ms) is one query over two tables that carry the
  // same columns — which is why those two numbers sit within noise of each
  // other, and why that row is not evidence about document-versus-relational.
  // The row that carries the comparison is the run comparison, and ADR-0015
  // rests its decision there and on the structural table.
  //
  // Two byte-identical copies invited reading them as two independent
  // measurements. One constant cannot be read that way.
  hybrid: EXTRACTED_SHOPPING_SQL,
  relational: EXTRACTED_SHOPPING_SQL,
}

export async function shoppingRequirements(
  client: Client,
  shape: string,
): Promise<readonly ShoppingLine[]> {
  const known = assertShape(shape)
  const sql = SHOPPING_SQL[known]
  if (sql === undefined) throw new Error(`no shopping query for shape ${known}`)
  await client.query(`set search_path to ${known}`)
  const r = await client.query<ShoppingLine>(sql)
  return r.rows
}

// --- QUERY 3: side-by-side comparison of two normalization runs -----------

/** One place where two runs of the same recipe disagree. */
export interface Difference {
  /** JSON Pointer into the Canonical Recipe. */
  readonly path: string
  readonly a: string | undefined
  readonly b: string | undefined
}

export interface RunComparison {
  readonly recipeId: string
  readonly versionA: number
  readonly versionB: number
  /** Leaf values present in both runs and equal. */
  readonly same: number
  readonly differences: readonly Difference[]
}

/** Flatten a recipe to JSON Pointer → scalar, so two runs can be set-compared. */
/**
 * One scalar at one JSON Pointer, with its JSON type kept beside its text.
 *
 * The type is not decoration. Leaves were compared as `String(value)` alone,
 * so `4` and `"4"`, `null` and `"null"`, `true` and `"true"` all read as no
 * difference at all — a run that changed a field's TYPE reported as identical.
 * The text is what a reader sees; the type is what makes the comparison true.
 */
export interface Leaf {
  /** `"string"`, `"number"`, `"boolean"`, `"null"`, `"undefined"`. */
  readonly type: string
  /** The value as it is displayed, unchanged from before. */
  readonly text: string
}

export function flatten(value: unknown, prefix = "", into = new Map<string, Leaf>()): Map<string, Leaf> {
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) flatten(v, `${prefix}/${i}`, into)
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flatten(v, `${prefix}/${k}`, into)
    }
  } else {
    into.set(prefix, { type: value === null ? "null" : typeof value, text: String(value) })
  }
  return into
}

export function diffRecipes(a: CanonicalRecipe, b: CanonicalRecipe): Omit<RunComparison, "recipeId" | "versionA" | "versionB"> {
  const fa = flatten(a)
  const fb = flatten(b)
  const differences: Difference[] = []
  let same = 0
  for (const path of new Set([...fa.keys(), ...fb.keys()])) {
    const x = fa.get(path)
    const y = fb.get(path)
    // Type AND text. Text alone made a type change invisible — see `Leaf`.
    if (x?.type === y?.type && x?.text === y?.text) {
      same += 1
    } else {
      // When only the TYPE differs, the two texts are identical and a bare
      // `4` against `4` reads as a reporting bug. Name the type in that case
      // and only that case, so every other difference prints as it always did.
      const typed = x !== undefined && y !== undefined && x.type !== y.type && x.text === y.text
      differences.push({
        path,
        a: typed && x !== undefined ? `${x.text} (${x.type})` : x?.text,
        b: typed && y !== undefined ? `${y.text} (${y.type})` : y?.text,
      })
    }
  }
  differences.sort((p, q) => (p.path < q.path ? -1 : p.path > q.path ? 1 : 0))
  return { same, differences }
}

/**
 * Compare two normalization runs of one recipe, THROUGH the repository
 * interface — `readTwoRuns` is operation 5, and it is the only operation that
 * needs a whole recipe rather than a projection of one. Identical code for both
 * shapes on purpose: what a shape costs here is what it costs to reconstruct two
 * complete recipes, and that is what the evaluation measures.
 */
export async function compareRuns(
  repo: RecipeRepository,
  recipeId: string,
  versionA: number,
  versionB: number,
): Promise<RunComparison> {
  const [a, b] = await repo.readTwoRuns(recipeId, versionA, versionB)
  return { recipeId, versionA, versionB, ...diffRecipes(a.recipe, b.recipe) }
}
