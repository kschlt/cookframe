# CFV1-S2 — findings

Measured 2026-09-20 over 18 real recipe sources (5 languages). Reproduce with
`python3 spikes/url-extraction/measure.py --html-dir <html> --status <status>` over `corpus.json`.
Rates are stated over **successfully fetched** pages; blocked pages are excluded, not counted as
absent.

## Results

- **Fetched:** 15/18. Blocked (HTTP 403, excluded from rates): all 3 `foodnetwork.com` pages.
- **Recipe JSON-LD present:** **14/15 (93%)** of fetched. The one miss is `lecker.de` — a 200
  response whose recipe is rendered without a static `Recipe` JSON-LD block.
- **Sufficient when present:** **14/14 (100%)**. Every page that carried `Recipe` JSON-LD carried
  all four required fields — `name`, `recipeIngredient`, `recipeInstructions`, `recipeYield`.

Per-field coverage (of the 14 present):

| field | coverage | field | coverage |
|---|---|---|---|
| name | 14/14 | cookTime | 14/14 |
| recipeIngredient | 14/14 | prepTime | 13/14 |
| recipeInstructions | 14/14 | totalTime | 11/14 |
| recipeYield | 14/14 | nutrition | 11/14 |
| author | 14/14 | image | 14/14 |
| description | 14/14 | | |

`recipeInstructions` shape varies and the adapter must handle all four: `list<HowToStep>` ×6,
`list<string>` ×5, `list<HowToSection>` (nested) ×2, bare `string` ×1.

## What the numbers say

1. **JSON-LD is present and sufficient on the overwhelming majority of fetchable mainstream recipe
   sites.** When it is there, it has never (0/14) been missing a required field. Recipe JSON-LD is
   an SEO standard, so mainstream publishers emit it as a matter of course.

2. **Sufficiency is about the required fields, and they are always there; the gaps are all in
   *optional* fields** (`nutrition` 11/14, `totalTime` 11/14, `prepTime` 13/14). Under the
   contract's omission-over-coercion rule these absences are represented as absent, so they are
   **not** a fallback trigger.

3. **The genuine fallback territory is JSON-LD *absence*, not JSON-LD *insufficiency*.** Exactly one
   fetched page (`lecker.de`) had no static `Recipe` block — a server/JS-rendered page. That is the
   class the fallback exists for.

## Answer: adapter shape & LLM necessity

- **Deterministic-first, with a narrow fallback.** Parse `Recipe` JSON-LD (handle `@graph`, `@type`
  arrays, and all four `recipeInstructions` shapes); on a JSON-LD-bearing page this yields the
  required fields deterministically, no model involved. Control passes to the fallback at one
  explicit point: **no `Recipe` JSON-LD block, or one missing a required field.**

- **The LLM is *not* required for URL extraction on JSON-LD-bearing pages** — which is the
  common case (14/15 here). Within S2's scope (extraction), no required field needed model
  assistance. The fallback for the JSON-LD-absent class should itself try *deterministic* routes
  first — microdata/RDFa, then targeted HTML selectors — and reserve an LLM for genuinely
  unstructured pages only. (Turning the extracted JSON-LD *strings* into the contract's structured
  `ValueExpression`s etc. is the separate normalization stage, measured in CFV1-S6, not URL
  extraction.)

- **Fallback coverage, per class:**
  - *JSON-LD absent* (e.g. `lecker.de`): needs an alternative extraction path to get structured
    data at all. This is the real fallback.
  - *optional fields missing* (nutrition/times): **no** fallback — represent as absent.

## Limits (stated, not silent)

- **WAF-blocked mainstream sites are under-represented:** chefkoch.de, foodnetwork.com, seriouseats,
  bbcgoodfood, allrecipes, thekitchn, theguardian all refuse automated fetch. chefkoch in
  particular is a primary real source and is **unmeasured** here. Most major sites do emit Recipe
  JSON-LD (SEO), so the 93%/100% finding *likely* generalises — but that is inference, and the
  blocked set is exactly where it should be confirmed. Kornelius can extend the corpus by saving
  those pages' HTML into the private html dir; the scorer consumes it unchanged.
- The corpus is a **representative** set from research, pending Kornelius's confirmation of his
  genuinely-used sources. Rates are attributable to that named population (`corpus.json`), not to a
  convenient grab.
- Sufficiency here means *required fields present*. It does not judge field *correctness* (e.g. a
  yield of "4" vs "4 Portionen") — that is the normalization stage's concern.
