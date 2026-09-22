/**
 * CFV1-SL4 — the deterministic URL capture path: a page's Schema.org/Recipe
 * JSON-LD becomes a capture *segmentation*, on exactly the same seam an image
 * capture uses (ADR-0004 {@link CaptureProvider}). No model, no network.
 *
 * Convergence, not a shortcut. This adapter yields a {@link CaptureResult} — the
 * source text and blocks WITHOUT ids — and nothing else. It therefore flows
 * through the unchanged spine (`captureSnapshot` → `storeSnapshot` → `reprocess`):
 * the block-id policy assigns the ids, `captureSnapshot` stamps identity and
 * provenance and validates before returning, and the same normalization capability
 * turns the snapshot into a Canonical Recipe. A URL import and an image import
 * converge on one Source Snapshot and one Canonical contract, with no path that
 * skips Snapshot creation or validation (CFV1-SL4 "one contract, no bypass").
 *
 * Deterministic-first (CFV1-S2). The spike measured Recipe JSON-LD present on
 * 14/15 fetched sources and sufficient on 14/14 present, so a page that carries
 * the fields the Canonical contract needs is mapped deterministically here, with
 * no model. A page whose JSON-LD is absent or insufficient is DECLINED — this
 * adapter throws {@link InsufficientRecipeJsonLdError} — which is the seam a later
 * model-fallback unit catches. This module is the deterministic half only; it
 * deliberately contains no fallback and no fetch.
 *
 * The parsing rules (flatten `@graph`, `@type` as string or array, the four
 * `recipeInstructions` shapes, the required-field sufficiency set) are the
 * production TypeScript re-authoring of the S2 measurement spike
 * (`spikes/url-extraction/measure.py`, which lives outside the build). No contract
 * shape is declared here (repo-config `slice0/schema-single-source-of-truth`); the
 * result is a plain {@link CaptureResult} the assembler validates against the
 * contract. No network primitive appears here (ADR-0010 chokepoint): the adapter
 * maps bytes already in hand — fetching them safely is a separate, later unit.
 */
import type { RawBlock } from "./block-id-policy.js"
import type { CaptureProvider, CaptureResult } from "./providers.js"
import { MultipleRecipesError, type RecipeInventory } from "./recipe-inventory.js"

/**
 * The fields the Canonical Recipe contract needs to build a record without
 * inventing (S2's "sufficient" set): a name, ingredients, instructions and a
 * yield. Optional fields (author, times, nutrition, image) are represented when
 * present and simply absent otherwise — their absence is not a fallback trigger.
 */
const REQUIRED_FIELDS = ["name", "recipeIngredient", "recipeInstructions", "recipeYield"] as const

/** Matches a `<script type="application/ld+json">…</script>` block, case-insensitively. */
const LD_SCRIPT = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

/** A plain JSON object (not an array, not null). */
type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * The outcome of reading a page's JSON-LD: either a Recipe object that carries
 * every required field, or an explicit statement of why the deterministic path
 * cannot handle the page (no Recipe present, or one missing required fields).
 */
export type RecipeExtraction =
  | { readonly kind: "sufficient"; readonly recipe: JsonObject }
  | { readonly kind: "multiple"; readonly inventory: RecipeInventory }
  | {
      readonly kind: "insufficient"
      readonly recipePresent: boolean
      readonly missingRequired: readonly string[]
    }

/** Parse one JSON-LD block, tolerating the HTML-comment / CDATA wrappers some sites emit. */
function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    const cleaned = raw
      .replace(/<!--/g, "")
      .replace(/-->/g, "")
      .replace(/^\s*\/\*[\s\S]*?\*\//, "")
      .trim()
    try {
      return JSON.parse(cleaned)
    } catch {
      return undefined
    }
  }
}

/** Yield every candidate object in a parsed value, flattening lists and `@graph`. */
function* iterNodes(parsed: unknown): Generator<JsonObject> {
  const stack: unknown[] = [parsed]
  while (stack.length > 0) {
    const node = stack.pop()
    if (Array.isArray(node)) {
      // Pushed in REVERSE so `pop` yields the page's own order. It did not
      // matter while only the richest node was kept, and it does now: CFV1-MR1's
      // refusal reports a title per recipe, and a person matching that list
      // against the page they are holding needs the two to run the same way.
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i])
    } else if (isJsonObject(node)) {
      yield node
      const graph = node["@graph"]
      if (Array.isArray(graph)) {
        for (let i = graph.length - 1; i >= 0; i--) stack.push(graph[i])
      }
    }
  }
}

/** Every JSON-LD object on the page, across all blocks, with `@graph` flattened. */
function loadLdObjects(html: string): JsonObject[] {
  const objects: JsonObject[] = []
  for (const match of html.matchAll(LD_SCRIPT)) {
    const raw = match[1]?.trim()
    if (raw === undefined || raw.length === 0) continue
    const parsed = tryParseJson(raw)
    if (parsed === undefined) continue
    for (const node of iterNodes(parsed)) objects.push(node)
  }
  return objects
}

/** `@type` is Recipe, whether it is a bare string or an array of types. */
function isRecipe(obj: JsonObject): boolean {
  const type = obj["@type"]
  if (typeof type === "string") return type === "Recipe"
  if (Array.isArray(type)) return type.includes("Recipe")
  return false
}

/** A value that carries information: a non-blank string, a non-empty list/object, or a number. */
function nonEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === "string") return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (isJsonObject(value)) return Object.keys(value).length > 0
  return true
}

/** How many required fields a candidate Recipe actually carries. */
function requiredSatisfiedCount(recipe: JsonObject): number {
  return REQUIRED_FIELDS.filter((field) => nonEmpty(recipe[field])).length
}

/** The required fields a Recipe is missing. */
function missingRequired(recipe: JsonObject): string[] {
  return REQUIRED_FIELDS.filter((field) => !nonEmpty(recipe[field]))
}

/**
 * The richest Recipe object on the page — the one satisfying the most required
 * fields. A page occasionally carries several Recipe nodes (e.g. a stub plus the
 * full one); picking by satisfied-field count matches the S2 spike's tie-break.
 */
/**
 * Collapse the Recipe nodes a page emits into the DISTINCT recipes it holds.
 *
 * Pages routinely emit one recipe twice — once inside `@graph` and once
 * standalone — and counting those as two would refuse a perfectly ordinary
 * single-recipe page. So duplicates are collapsed, and the richest node of each
 * group is the one kept, preserving what `selectRichestRecipe` did within a
 * group while no longer discarding across groups.
 *
 * The two error directions are not symmetric, and the identity rule is chosen
 * for that: collapsing too eagerly silently drops a recipe, which is the exact
 * harm this unit exists to prevent, while collapsing too little refuses a page
 * that could have been imported — recoverable, and it says so. So a node joins
 * an existing group only on a signal that is actually the same recipe: an equal
 * normalized `name`, or an equal `@id` when neither carries a name. A node with
 * neither gets a group of its own, so an unnameable recipe RAISES the count
 * rather than vanishing into another.
 *
 * **`@id` separates even when the names agree.** An earlier version consulted
 * `@id` only where BOTH nodes lacked a name, so two nodes sharing a name
 * collapsed however plainly their identifiers said they were different nodes.
 * Two variants of one dish on a page — ice cream with and without a machine,
 * overnight and same-day dough — carry the same `name` and different `@id`, and
 * the richer one was imported while the other vanished without trace. That is
 * this unit's own defect, reached through the guard meant to stop it, so the
 * rule now reads the strongest available discriminator instead of discarding it
 * exactly where it would decide.
 *
 * Only a PRESENT and DIFFERING pair separates. Equal, absent on both sides, or
 * present on one side only collapses as before, because none of those is
 * evidence of a second recipe — and the duplicate emission this function exists
 * for (`@graph` plus standalone) is precisely the equal-or-absent case.
 */
function distinctRecipes(objects: readonly JsonObject[]): readonly JsonObject[] {
  // Grouped by name first, then split by `@id` within a name. Two passes rather
  // than one composite key, because a node carrying a name but no `@id` must
  // still land in its name's group: keying on both at once would give it a group
  // of its own and refuse an ordinary page whose duplicate emission omits `@id`.
  const groups = new Map<string, JsonObject[]>()
  let anonymous = 0
  for (const obj of objects) {
    if (!isRecipe(obj)) continue
    const name = asDisplayString(obj["name"])?.toLowerCase().replace(/\s+/g, " ")
    const id = asDisplayString(obj["@id"])
    const key =
      name !== undefined ? `name:${name}` : id !== undefined ? `id:${id}` : `#${anonymous++}`
    const held = groups.get(key)
    if (held === undefined) groups.set(key, [obj])
    else held.push(obj)
  }

  const richest = (nodes: readonly JsonObject[]): JsonObject =>
    nodes.reduce((best, node) =>
      requiredSatisfiedCount(node) > requiredSatisfiedCount(best) ? node : best,
    )

  const out: JsonObject[] = []
  for (const members of groups.values()) {
    // The distinct `@id`s inside this name group. Two or more mean the page
    // itself says these are different nodes, whatever their names agree on.
    const byId = new Map<string, JsonObject[]>()
    for (const node of members) {
      const id = asDisplayString(node["@id"])
      if (id === undefined) continue
      const held = byId.get(id)
      if (held === undefined) byId.set(id, [node])
      else held.push(node)
    }
    if (byId.size > 1) {
      // One recipe per distinct `@id`. Members without an `@id` carry no signal
      // that they are a further recipe, so they fold in rather than inflating
      // the count — collapsing too little refuses an importable page, which is
      // the recoverable direction but still a cost.
      for (const sameId of byId.values()) out.push(richest(sameId))
    } else {
      out.push(richest(members))
    }
  }
  return out
}

/** The inventory of a page's distinct recipes, in the order they were emitted. */
function inventoryOf(recipes: readonly JsonObject[]): RecipeInventory {
  return { count: recipes.length, titles: recipes.map((r) => asDisplayString(r["name"])) }
}

/**
 * Read a page's JSON-LD and decide whether the deterministic path can map it:
 * `sufficient` with the chosen Recipe, or `insufficient` naming what is missing.
 */
export function extractRecipeJsonLd(html: string): RecipeExtraction {
  const recipes = distinctRecipes(loadLdObjects(html))
  // CFV1-MR1. A page holding several recipes is REFUSED with what it holds, and
  // the refusal is decided before sufficiency: a page with three recipes is not
  // a page to extract one from, however complete that one is, so it must not
  // fall through to the model fallback the `insufficient` seam exists for.
  if (recipes.length > 1) {
    return { kind: "multiple", inventory: inventoryOf(recipes) }
  }
  const recipe = recipes[0]
  if (recipe === undefined) {
    return { kind: "insufficient", recipePresent: false, missingRequired: [...REQUIRED_FIELDS] }
  }
  const missing = missingRequired(recipe)
  if (missing.length > 0) {
    return { kind: "insufficient", recipePresent: true, missingRequired: missing }
  }
  return { kind: "sufficient", recipe }
}

/** A JSON-LD scalar as a display string: a trimmed non-blank string, or a finite number. */
function asDisplayString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

/** An author display string from the several shapes Schema.org allows (string, Person, list). */
function authorDisplay(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const name = authorDisplay(item)
      if (name !== undefined) return name
    }
    return undefined
  }
  if (isJsonObject(value)) return asDisplayString(value["name"])
  return asDisplayString(value)
}

/** A yield display string: the first entry when several contextual yields are given. */
function displayYield(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const yielded = asDisplayString(item)
      if (yielded !== undefined) return yielded
    }
    return undefined
  }
  return asDisplayString(value)
}

/** `recipeIngredient` as a list of lines, tolerating a single string. */
function ingredientLines(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value]
  const lines: string[] = []
  for (const item of items) {
    const line = asDisplayString(item)
    if (line !== undefined) lines.push(line)
  }
  return lines
}

/** One instruction as it maps to a block: its text, and the section heading when nested. */
interface InstructionStep {
  readonly heading?: string
  readonly text: string
}

function withHeading(heading: string | undefined, text: string): InstructionStep {
  return heading !== undefined ? { heading, text } : { text }
}

/** Split a bare instructions string on line breaks, so its own structure is kept, not invented. */
function splitProse(text: string): string[] {
  const lines = text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length > 0) return lines
  const whole = text.trim()
  return whole.length > 0 ? [whole] : []
}

/** Is this element a HowToSection (by `@type`, or by carrying an `itemListElement`)? */
function isHowToSection(element: JsonObject): boolean {
  const type = element["@type"]
  if (typeof type === "string" && type === "HowToSection") return true
  if (Array.isArray(type) && type.includes("HowToSection")) return true
  return Array.isArray(element["itemListElement"])
}

/** Steps from one `recipeInstructions` element, dispatching on its shape. */
function stepsFromElement(
  element: unknown,
  inheritedHeading: string | undefined,
): InstructionStep[] {
  if (typeof element === "string") {
    const text = element.trim()
    return text.length > 0 ? [withHeading(inheritedHeading, text)] : []
  }
  if (!isJsonObject(element)) return []
  if (isHowToSection(element)) {
    const heading = asDisplayString(element["name"]) ?? inheritedHeading
    const items = element["itemListElement"]
    const list = Array.isArray(items) ? items : []
    const steps: InstructionStep[] = []
    for (const item of list) steps.push(...stepsFromElement(item, heading))
    return steps
  }
  // A HowToStep (or step-like object): its text, falling back to its name.
  const text = asDisplayString(element["text"]) ?? asDisplayString(element["name"])
  return text !== undefined ? [withHeading(inheritedHeading, text)] : []
}

/** All instruction steps from `recipeInstructions`, across its four Schema.org shapes. */
function instructionSteps(value: unknown): InstructionStep[] {
  if (typeof value === "string") return splitProse(value).map((text) => ({ text }))
  const elements = Array.isArray(value) ? value : [value]
  const steps: InstructionStep[] = []
  for (const element of elements) steps.push(...stepsFromElement(element, undefined))
  return steps
}

/**
 * Map a sufficient Recipe object to a capture segmentation: title, author, the
 * metadata fields that are present, one ingredient block per line, and one
 * instruction block per step (its section carried as the block heading). Order is
 * reading order. No block carries an id — the policy is the sole source of ids.
 */
export function recipeToRawBlocks(recipe: JsonObject): RawBlock[] {
  const blocks: RawBlock[] = []
  let order = 0
  const push = (block: Omit<RawBlock, "order">): void => {
    blocks.push({ order, ...block })
    order += 1
  }

  const name = asDisplayString(recipe["name"])
  if (name !== undefined) push({ type: "title", text: name })

  const author = authorDisplay(recipe["author"])
  if (author !== undefined) push({ type: "author", text: author })

  const yielded = displayYield(recipe["recipeYield"])
  if (yielded !== undefined) push({ type: "metadata", heading: "recipeYield", text: yielded })

  for (const field of ["prepTime", "cookTime", "totalTime", "description"] as const) {
    const value = asDisplayString(recipe[field])
    if (value !== undefined) push({ type: "metadata", heading: field, text: value })
  }

  for (const line of ingredientLines(recipe["recipeIngredient"])) {
    push({ type: "ingredient", text: line })
  }

  for (const step of instructionSteps(recipe["recipeInstructions"])) {
    push(
      step.heading !== undefined
        ? { type: "instruction", heading: step.heading, text: step.text }
        : { type: "instruction", text: step.text },
    )
  }

  return blocks
}

/** A plain-text rendering of the segmentation, kept as the snapshot's `capturedText`. */
function capturedTextFrom(blocks: readonly RawBlock[]): string {
  return blocks
    .map((block) => (block.heading !== undefined ? `${block.heading}: ${block.text}` : block.text))
    .join("\n")
}

/**
 * Map a sufficient Recipe object to a {@link CaptureResult}: `sourceType: "url"`,
 * the rendered source text, the segmentation, and the parsed Recipe object kept
 * verbatim as `structuredSourcePayload` (so a Canonical fact can reference the raw
 * source via a payload pointer, alongside the block ids).
 */
export function recipeToCaptureResult(recipe: JsonObject): CaptureResult {
  const blocks = recipeToRawBlocks(recipe)
  return {
    sourceType: "url",
    capturedText: capturedTextFrom(blocks),
    blocks,
    structuredSourcePayload: recipe,
  }
}

/** Why the deterministic path declined a page. */
export type InsufficientReasonCode = "no_recipe_jsonld" | "insufficient_recipe_jsonld"

/**
 * Thrown when a page cannot be mapped deterministically: no Recipe JSON-LD, or a
 * Recipe missing required fields. It is the discriminable seam a later model
 * fallback catches to cover the gap the S2 spike measured — it never becomes a
 * partial import.
 */
export class InsufficientRecipeJsonLdError extends Error {
  readonly reasonCode: InsufficientReasonCode
  readonly recipePresent: boolean
  readonly missingRequired: readonly string[]

  constructor(extraction: Extract<RecipeExtraction, { kind: "insufficient" }>) {
    super(
      extraction.recipePresent
        ? `Recipe JSON-LD present but missing required fields: ${extraction.missingRequired.join(", ")}`
        : "no Recipe JSON-LD found in the page",
    )
    this.name = "InsufficientRecipeJsonLdError"
    this.reasonCode = extraction.recipePresent ? "insufficient_recipe_jsonld" : "no_recipe_jsonld"
    this.recipePresent = extraction.recipePresent
    this.missingRequired = extraction.missingRequired
  }
}

/**
 * The deterministic URL capture capability (ADR-0004 seam). `input` is the page's
 * bytes, already fetched; the adapter maps their JSON-LD and never opens the
 * network. A page with sufficient Recipe JSON-LD becomes a segmentation; an
 * insufficient one throws {@link InsufficientRecipeJsonLdError} rather than
 * importing partial content.
 */
export function createDeterministicUrlCaptureProvider(): CaptureProvider {
  return {
    async capture(input): Promise<CaptureResult> {
      const html = new TextDecoder().decode(input)
      const extraction = extractRecipeJsonLd(html)
      if (extraction.kind === "multiple") {
        throw new MultipleRecipesError(extraction.inventory)
      }
      if (extraction.kind === "insufficient") {
        throw new InsufficientRecipeJsonLdError(extraction)
      }
      return recipeToCaptureResult(extraction.recipe)
    },
  }
}
