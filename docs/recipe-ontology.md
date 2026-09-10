# Cookframe — Recipe Ontology

Status: Discovery baseline; implementation-independent  
Scope: Product/information design. This is intentionally not an implementation schema.

## 1. Purpose

The system converts heterogeneous recipe sources into a durable, provider-independent recipe representation that can be re-used for discovery, shopping, preparation, active cooking and external adapters.

The core information model must support:

1. a durable, source-faithful capture record after transient scan images are discarded;
2. a normalized Canonical Recipe that contains recipe facts, not UX interpretation;
3. deterministic external mappings such as Schema.org/Recipe and Bring-compatible pages;
4. replaceable Derived Cooking Plans for execution-oriented presentation;
5. traceability from normalized facts back to captured source blocks;
6. re-normalization and re-generation when prompts, models or ontology versions improve;
7. preservation of common, source-grounded recipe facts even when V1 does not yet expose a feature that uses them.

The Canonical Recipe is the center of the system. Input adapters, model providers, HTML, Bring!, storage and deployment infrastructure are replaceable concerns around it.

---

## 2. Source-adapter principle

Capture is source-specific; normalization is shared.

```text
Image / Screenshot ──→ Image Source Adapter ──┐
                                              │
Recipe URL ─────────→ URL Source Adapter ─────┼─→ Source Snapshot
                                              │
Future text/share ──→ other adapter ──────────┘
                                                    ↓
                                               Normalization
                                                    ↓
                                             Canonical Recipe
```

### 2.1 Image Source Adapter

For photos/screenshots:
- use multimodal extraction to capture all recipe-relevant text and document structure;
- treat the input image as transient processing input;
- discard the scan image after successful capture under the product's capture-quality policy;
- do not treat a photographed cookbook page as the recipe's hero image.

Image deletion is an intentional simplicity decision, not a statement that pixels and captured text are equivalent. Once deleted, improved image capture cannot be re-run for that item.

### 2.2 URL Source Adapter

For recipe URLs:
1. fetch the page as untrusted external input;
2. prefer existing structured recipe data, especially Schema.org/Recipe JSON-LD;
3. preserve relevant structured source payload plus recipe text in the Source Snapshot;
4. fall back to recipe-relevant DOM/text extraction when structured data is missing or incomplete;
5. use LLM assistance only where deterministic extraction/mapping is insufficient.

The source URL, source/site attribution and source-provided author information remain provenance when available.

---

## 3. Three information layers

### Layer A — Source Snapshot

**Question:** What did the capture process record from the source?

The Source Snapshot is the durable, source-faithful capture record used for future normalization after the original scan image is no longer retained. It may contain capture errors and is **not semantically equivalent to the original pixels**.

It should preserve:
- complete captured recipe text;
- source-visible section structure where identifiable;
- headings and labels;
- ingredient lines as written;
- instruction paragraphs/steps as written;
- source time/yield/metadata labels as written;
- source-provided nutrition, cuisine/category/diet/difficulty/keyword labels and equipment/tool text when present;
- notes, warnings, tips and other recipe-relevant text;
- unclassified recipe-relevant text rather than dropping it;
- structured source payload when available, e.g. Recipe JSON-LD.

Conceptual shape:

```text
SourceSnapshot
- id
- version
- sourceType: image | url | text | other
- sourceUrl?
- sourceSite?
- sourceAttribution?
- capturedText
- structuredSourcePayload?
- blocks[]
    - id                  # stable within the snapshot
    - order
    - type: title | metadata | ingredient_group | ingredient |
            instruction_group | instruction | note | author | other
    - heading?
    - text
- captureProvenance
```

Stable block identities are required so normalized facts can reference the captured evidence from which they were produced.

### Layer B — Canonical Recipe

**Question:** What structured recipe facts does the captured source describe?

The Canonical Recipe may:
- parse quantity/value expressions;
- separate names, units and qualifiers;
- normalize source labels into stable time/yield categories;
- preserve ingredient groups and instruction sections;
- structure explicit ingredient allocations, reservations, times, temperatures, waits, doneness cues and prerequisites;
- normalize formatting while retaining source wording where needed.

It must not:
- invent missing ingredients, quantities, temperatures or durations;
- fabricate authorship;
- change culinary quantities, temperatures or outcome;
- substitute ingredients;
- optimize or reorder the cooking sequence;
- infer nutrition, cuisine, diet, difficulty or other classifications that the source does not state;
- drop a common source-grounded fact merely because no V1 projection uses it yet.

### Layer C — Derived Cooking Plan

**Question:** How can the same recipe be presented so that it is easier and less stressful to execute?

The Cooking Plan is replaceable derived data. It may:
- group source-grounded facts into execution-oriented units;
- promote prerequisites/look-ahead information earlier in the presentation;
- colocate ingredients and quantities with the relevant action;
- reduce prose;
- expose explicit or very conservative concurrency cues.

It does not become the first place where recipe facts such as temperatures, durations or allocations are structured.

---

## 4. Traceability and provenance

Traceability is a product requirement, not debugging trivia.

At minimum:
- Source Snapshot blocks have stable IDs;
- Canonical ingredients, instruction steps and source-grounded critical facts carry `sourceRefs` to one or more Source Snapshot blocks or to a stable address within a structured source payload;
- for JSON-LD or equivalent structured payloads, a `sourceRef` identifies the relevant node/property (for example by stable ID, JSON Pointer or an equivalent address), not merely the payload as a whole;
- each processing stage records a distinct run identity.

Conceptually distinguish:

```text
Capture Run
- source adapter + version
- model/provider when used
- capture prompt-component versions
- Source Snapshot identity

Normalization Run
- Source Snapshot identity/version
- normalization model/provider
- normalization prompt-component versions
- target ontology version

Cooking Plan Run
- Canonical Recipe identity/version
- cooking model/provider
- cooking prompt version
- Cooking Plan version
```

A future normalization improvement can reprocess all stored Source Snapshots. A future image-capture improvement cannot recover deleted scan pixels.

---

## 5. Canonical Recipe v1 — product-level field model

The ontology should remain deliberately small, but not so small that common recipe facts are forced into free text.

### Design principle — Preserve broadly; canonicalize deliberately; derive separately

V1 feature scope and Canonical data scope are related but not identical.

Rules:
- **Preserve broadly:** the Source Snapshot captures recipe-relevant source information even when it is not yet modeled canonically.
- **Canonicalize deliberately:** common, clearly understood, source-grounded recipe facts that are broadly reusable should be structured in Canonical even when V1 does not yet render, search or plan with them.
- **Derive separately:** inferred classifications, scores, embeddings, health judgments, recommendation features and user-specific preferences do not become source facts. They belong in replaceable derived enrichment or instance state with their own provenance/versioning.
- **Do not model hypothetical futures:** future-readiness is not permission to add speculative fields. Extend Canonical only for recurring real recipe phenomena or broadly useful source-provided facts whose semantics are sufficiently understood.

A fact being present in Canonical does **not** imply that V1 must expose a corresponding feature or UI.

### 5.1 Identity, attribution and source-provided classifications

```text
Recipe
- id
- schemaVersion
- title
- description?
- authors[]?             # source-provided only
- sourcePublisher?       # site/book/publisher when available
- sourceName?            # e.g. Chefkoch, cookbook title
- sourceUrl?
- sourceClassifications[]?
    - kind: cuisine | category | meal_type | diet | difficulty | keyword | cooking_method | other
    - sourceText
    - normalizedValue?   # only semantics-preserving/deterministic normalization
    - vocabulary?        # e.g. schema.org or source-native vocabulary
    - identifier?        # e.g. source code/URI such as Schema.org VegetarianDiet
    - sourceRefs[]
```

Authorship, source/site and publisher are separate concepts. Missing author stays missing. An external adapter may report incompatibility when it requires an author; it must not silently invent one.

`sourceClassifications` contains only classifications actually provided by the source (visible text and/or structured source data). For example, source-provided `VegetarianDiet` is a Canonical source fact; a future system inference that the ingredient list appears vegetarian is a separate derived enrichment and must not be represented as the same fact.

The model does not establish a universal taxonomy in V1. It preserves source semantics and may apply only narrow, deterministic normalization where meaning is not changed.

### 5.2 Reusable value-expression principle

Real recipes do not only contain exact scalars. V1 conceptually supports:

```text
ValueExpression
- sourceText
- kind: exact | range | approximate | minimum | maximum | qualitative | none
- value?                 # exact numeric
- minValue?              # range/minimum
- maxValue?              # range/maximum
- qualifierText?         # e.g. "about", "at least", "to taste", "overnight"
```

The exact storage shape is an implementation decision. The product invariant is that source wording is retained and common non-scalar forms are not forced into invented exact numbers.

### 5.3 Yield / servings

A recipe may have more than one valid yield statement. V1 therefore models **`yields[]`**, not a single mandatory scalar yield.

```text
yields[]
- id
- sourceText
- valueExpression
- unit?                  # servings, persons, pieces, loaf, etc.
- contextText?           # source-grounded context, e.g. "as a side dish"
- scalingEligibility: allowed | disallowed | unknown
- sourceRefs[]
```

Examples that must be representable:
- `4 servings`
- `4–6 servings`
- `about 12 cookies`
- `1 loaf`
- `4 servings as a side dish` **and** `2 persons as a main course` on the same recipe

Do not collapse multiple source yield statements into one synthetic value. A consuming projection/adapter may choose or ask for one only when its behavior is explicit and non-destructive.

A numeric value does not automatically imply safe proportional scaling. `scalingEligibility` is **conservative, versioned derived policy metadata**, not normally a source fact. It defaults to `unknown` unless explicit source evidence or an approved deterministic rule establishes the behavior.

### 5.4 Time information

```text
times[]
- type: prep | cook | bake | rest | marinate | chill | total | active | passive | other
- sourceLabel?
- durationExpression
- sourceRefs[]
```

Duration expressions must represent forms such as:
- `10 min`
- `10–12 min`
- `at least 30 min`
- `about 1 hour`
- `overnight`

Rules:
- only populate a time when source-grounded;
- do not invent total time from incomplete components unless explicitly stored as derived metadata elsewhere;
- preserve source distinctions rather than collapsing all times into one number.

### 5.5 Source-grounded equipment

Equipment is a common recipe fact relevant to readiness, feasibility and future planning. Canonical should preserve equipment that is explicitly named by the source, whether it appears in a dedicated equipment list or directly in instructions.

```text
equipment[]
- id
- sourceText
- name
- quantityExpression?
- qualifiers[]
- sourceRefs[]
```

Do not infer equipment merely from culinary semantics (for example, do not create `frying pan` solely because a source says “fry” if no pan/tool is named). Such inference may later exist as derived enrichment.

### 5.6 Ingredient groups and ingredients

```text
ingredientGroups[]
- id
- title?
- sourceRefs[]
- ingredients[]
    - id
    - sourceText
    - quantityExpression?
    - unit?
    - name
    - qualifiers[]
    - optional?
    - scalingEligibility: proportional | non_scalable | unknown
    - sourceRefs[]
```

Examples that must remain representable without invention:
- `2 eggs`
- `1–2 tbsp oil`
- `about 100 g flour`
- `salt to taste`
- `some parsley`
- no explicit amount.

Principle:

> Normalize structure, not culinary meaning.

Ingredient-level `scalingEligibility` is conservative, versioned derived policy metadata:
- `proportional`: this quantity may be multiplied by the requested recipe-scale factor;
- `non_scalable`: this quantity is deliberately held constant when the rest of the recipe scales;
- `unknown`: the system does not know a safe automatic scaling behavior.

`unknown` is **not** equivalent to `non_scalable`. Unknown behavior blocks automatic whole-recipe scaling rather than silently leaving the quantity unchanged.

Do not introduce a large semantic food ontology in V1. Ingredient aliases/categories may later be a separate derived enrichment layer.

### 5.7 Canonical instruction structure

Instruction facts that are explicitly present in the source belong here, not only in the Cooking Plan.

```text
instructionSections[]
- id
- title?
- sourceRefs[]
- steps[]
    - id
    - sourceText
    - normalizedActionText
    - sourceRefs[]

    - ingredientUses[]
    - componentUses[]
    - equipmentUses[]          # references source-grounded equipment where explicit
    - producesComponents[]

    - durations[]
    - temperatures[]
    - donenessCues[]
    - prerequisiteCues[]
    - waitCues[]
```

`normalizedActionText` may clean formatting/segmentation but should not change the culinary instruction.

#### Ingredient use / reservation semantics

V1 must distinguish at least:

```text
IngredientUse
- ingredientId
- usage: use_now | reserve_for_later | use_remaining | use_partial_unspecified | use_all
- quantityExpression?
- unit?
- sourceText?
- sourceRefs[]
```

Examples:
- `use 100 g of 250 g mushrooms now`
- `reserve 1 tbsp for garnish`
- `use half`
- `add some; keep the rest`

If the source does not specify the split, the system must not create an exact split.

#### Minimal intermediate-component support

Raw ingredient links are insufficient for cases such as:

> Mix the dressing, then reserve 2 tbsp of the dressing for later.

V1 therefore permits lightweight named intermediate components without attempting a full food-state ontology:

```text
PreparedComponent
- id
- label                 # source-grounded, e.g. "dressing", "sauce", "dough"
- createdByStepId
- sourceRefs[]

ComponentUse
- componentId
- usage: use_now | reserve_for_later | use_remaining | use_partial_unspecified | use_all
- quantityExpression?
- unit?
- sourceText?
- sourceRefs[]
```

This is deliberately minimal. It records source-explicit prepared objects so later steps can refer to them; it does not model arbitrary culinary state transitions.

#### Step-local critical facts

Canonical normalization should structure source-explicit:
- durations/ranges;
- temperatures and heating context when present;
- doneness/visual endpoint cues;
- explicit waits/rests;
- prerequisites such as preheating, thawing, soaking or reserving;
- source-explicit concurrency such as “meanwhile” or “while X bakes”.

These remain recipe facts even if the Cooking UX later changes where or how prominently they are displayed.

### 5.8 Source-provided nutrition

Nutrition is Canonical only when the source provides it. V1 does not calculate nutrition from ingredients and does not evaluate whether a recipe is healthy.

The reference basis is part of the fact. `297 kcal` without knowing whether it means per serving, per 100 g or the whole recipe is not sufficient for reliable later planning.

```text
nutritionStatements[]
- id
- sourceText?
- basis
    - kind: whole_recipe | per_yield | per_serving | per_quantity | other | unknown
    - yieldRef?               # only when the relation to a specific yield is explicit/unambiguous
    - quantityExpression?     # e.g. 100
    - unit?                   # e.g. g, ml
    - sourceText?
- facts[]
    - nutrient: energy | protein | carbohydrate | fat | fiber | sugar | sodium | cholesterol | saturated_fat | trans_fat | other
    - sourceLabel?
    - valueExpression
    - unit?                   # e.g. kcal, kJ, g, mg
    - sourceRefs[]
- sourceRefs[]
```

Examples:
- `297 kcal per serving` → preserve the `per_serving` basis; attach `yieldRef` only if the source unambiguously identifies which yield that serving refers to.
- `65 kcal per 100 g` → `per_quantity`, quantity `100`, unit `g`.
- `1200 kcal for the whole recipe` → `whole_recipe`.

If a source has multiple contextual yields and says only `per serving`, do not guess which yield it references. Preserve the basis wording and uncertainty losslessly.

Schema.org `NutritionInformation` may be a useful external mapping for representable source facts, but it does not define Canonical semantics.

### 5.9 Scaling policy semantics

Scaling is deterministic and conservative. The recipe-scale decision composes yield-level and ingredient-level policy metadata rather than assuming that every numeric value scales.

Product invariants:
- scaling policy metadata is versioned and reproducible;
- recipe/yield `allowed` means every affected quantity has **determinate** behavior;
- `proportional` quantities scale by the requested factor;
- `non_scalable` quantities remain constant by design;
- any affected `unknown` quantity prevents automatic whole-recipe scaling;
- qualitative/open-ended expressions such as `to taste` are not converted into invented numeric values;
- source wording remains available even when a deterministic scaled display is produced.

A future implementation may use explicit source evidence and/or approved deterministic rules to classify scaling behavior. The classification algorithm and rule set remain an eval/implementation decision.

---

## 6. Context projections

The same Canonical Recipe supports four information jobs:

```text
Canonical Recipe
        ↓
Projection policies
        ├── Discovery / selection
        ├── Shopping / planning
        ├── Preparation / readiness
        └── Active cooking
```

These are **jobs/projection policies**, not a requirement for four separate navigation modes.

- **Discovery:** Is this attractive and feasible to cook now?
- **Shopping:** What is required in total?
- **Preparation:** What must be fetched, measured, prepared, reserved, preheated or started before/early in execution?
- **Active cooking:** What do I need now, what do I do now, what is critical, and what comes next?

Instance policy such as `assumedAtHand` may alter retrieval prominence, but it does not alter recipe truth and must never hide required measurement/preparation/reservation/current-step information.

Canonical availability is broader than V1 presentation. Source-provided nutrition/classifications/equipment may be stored even when no V1 projection currently displays or filters on them.

---

## 7. Media model

Recipe media is separate from source evidence.

```text
RecipeMedia
- heroImage?
    - storageIdentity
    - origin: source_url | user_added | other
    - originalSourceUrl?
    - attribution?
```

Rules:
- scanned cookbook pages are not hero images;
- a URL adapter may capture a source-provided finished-dish image;
- hero media is optional and used primarily for discovery/library presentation;
- media normalization/compression is deterministic;
- step-by-step generated imagery is out of scope for V1.

---

## 8. Reprocessing semantics

The system should support independently re-running:

```text
Source Snapshot
→ new Normalization Run
→ Canonical Recipe vN

Canonical Recipe
→ new Cooking Plan Run
→ Cooking Plan vN
```

The system must explicitly distinguish this from re-capture:

```text
Deleted source scan
→ cannot be re-captured later
```

Source Snapshot history/version retention policy can be implementation-specific, but reprocessing must not overwrite provenance in a way that makes comparison impossible.

---

## 9. External mappings and Bring adapter

Schema.org/Recipe is an interoperability output, not the canonical ontology.

External mappings are deterministic and versioned:

```text
Canonical Recipe
→ Mapping version
→ Schema.org/Recipe
→ Bring-compatible public page / adapter
```

Bring is a dedicated adapter with its own compatibility contract and tests. The product must not assume that “valid Schema.org” automatically means “works in Bring”.

Schema.org mapping rules:
- map source-provided cuisine/category/diet/keywords, nutrition and explicitly named equipment where the Canonical semantics can be represented without invention;
- preserve multiple/contextual Canonical yields even when a downstream adapter can consume only one; adapter-specific selection must be explicit and non-destructive;
- map exact representable durations deterministically to Schema.org `Duration` values;
- do **not** coerce ranges, qualitative durations or open-ended expressions such as `10–12 min`, `at least 30 min` or `overnight` into invented ISO durations; omit such values from incompatible Schema.org duration properties or preserve them elsewhere losslessly.

Current product-level requirements for the Bring adapter:
- preserve source-grounded author/title/ingredients where available;
- never fabricate recipe authorship merely to satisfy Bring;
- explicitly handle an author-missing compatibility state;
- test quantity parsing/scaling behavior, no-image recipes, tokenized URLs, return navigation and recipe-sharing behavior against Bring itself;
- do not delegate requested-quantity scaling to Bring unless the complete exported ingredient set is compatible with Bring's observed scaling semantics; otherwise export the chosen/base quantities without Bring-side scaling or expose scaling as unavailable;
- keep Bring-specific behavior outside the core ontology.

---

## 10. Image deletion decision and release gate

V1 intends to discard scan images after successful capture.

This is acceptable only under two separate conditions:

1. **Per-item capture success:** the capture output is structurally usable and contains the recipe-relevant sections needed for normalization; exact checks are an implementation detail.
2. **Product-level capture eval:** a representative public/private golden set demonstrates acceptable critical-field accuracy for the intended source types before this becomes the production default.

There is no end-user review workflow in V1. Quality is primarily established by pipeline evals and regression fixtures, not by asking the user to approve every import.

---

## 11. Explicit non-goals for ontology v1

Do not add now:
- nutrition **inference/calculation**, health scoring/coaching or nutrition-driven recommendation/planning behavior; source-provided nutrition facts may still be preserved/normalized;
- cuisine/diet/difficulty **inference** or a universal classification taxonomy; source-provided classifications may still be preserved/normalized;
- recommendation/ranking engine;
- weekly/meal planning engine;
- multi-recipe shopping aggregation engine;
- universal food taxonomy;
- generalized unit conversion engine;
- generalized pantry inventory;
- full intermediate-food-state graph;
- arbitrary workflow/task planner;
- LLM-authored replacement recipes;
- inferred exact quantities when the source is vague;
- implementation-specific database schema.

Future applications may derive new artifacts from Canonical Recipe and/or Source Snapshot without moving those derived judgments into source truth.

---

## 12. Future-readiness test case

The following source must be representable without forcing V1 to implement planning/recommendation features:

> “4 servings as a side dish; 2 persons as a main course; approximately 297 kcal per serving; simple; source-provided cuisine/category/diet labels.”

Expected preservation:
- two distinct `yields[]` with their source-grounded contexts;
- one source-provided nutrition statement with `297 kcal` and its source-stated basis; if `per serving` is ambiguous across the two yields, that ambiguity remains explicit rather than guessed;
- source-provided difficulty/cuisine/category/diet values in `sourceClassifications[]`;
- all values carry source references/provenance;
- no recommendation, health judgment, meal-plan score or inferred dietary classification is created merely because the data is available.

This test expresses the architecture principle: **preserve broadly; canonicalize deliberately; derive separately.**
