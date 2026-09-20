# Public fixtures

Test data that ships in the repository. **Every fixture here is SYNTHETIC or
SELF-AUTHORED.** No real third-party recipe text, image, or photograph is ever
committed to this public repository — only invented content and functional facts
(quantities, action verbs, procedures). Real cookbook scans and personal recipes
stay outside `kschlt/cookframe`. Every fixture carries the "Cookframe Fixtures"
source name — and, where it records a URL at all, the reserved `example.invalid`
domain — so it can never be mistaken for a real source.

Each fixture is labelled below with its **class** (the source shape it exercises,
after the CFV1-S6 patterns) and its **origin** (always synthetic or
self-authored). `source-snapshot/*.json` validate against `SourceSnapshot` and
`canonical/*.json` against `CanonicalRecipe`; the contract is `.strict()`, so the
class/origin label lives here rather than inside the fixture JSON.
`tests/fixtures/public-fixtures.test.ts` enforces that every fixture parses and
that every fixture file is listed here.

## `source-snapshot/`

| File | Class | Origin |
|---|---|---|
| `basic.json` | structured (single group, URL source) | synthetic |
| `structured-multi-component.json` | structured (multiple ingredient and instruction groups) | synthetic |
| `freetext-heavy.json` | freetext-heavy (narrative prose, few structural markers) | synthetic |
| `gappy.json` | gappy (sparse, missing quantities and groups) | synthetic |

## `canonical/`

| File | Class | Origin |
|---|---|---|
| `two-yields-nutrition.json` | future-readiness (two contextual yields, ambiguous nutrition basis) | synthetic |
