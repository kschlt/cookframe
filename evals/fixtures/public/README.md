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
| `injection-instruction-carrying.json` | adversarial (CFV1-INJ: page text addressed to the model, including an attempt to close the data fence) | synthetic |
| `injection-plain-page.json` | adversarial (CFV1-INJ: an ordinary short page, used as the page a fabricated recipe is falsely attributed to) | synthetic |

The two `injection-*` fixtures are **written to be attacked with, not by**. Their
text is invented like every other fixture here, and the instruction-carrying one
deliberately contains wording aimed at a model ("ignore all previous
instructions", a forged data-fence terminator, an instruction to add an
ingredient that is not on the page). It is data for
`tests/injection/injection.test.ts`, which drives it through the real extraction
path with a scripted transport and asserts the page changes nothing — no model
and no network are involved. Nothing in either file is a real site, a real
recipe, or a working exploit against anything outside this repository.

## `canonical/`

| File | Class | Origin |
|---|---|---|
| `two-yields-nutrition.json` | future-readiness (two contextual yields, ambiguous nutrition basis) | synthetic |
| `ranges-and-qualitative.json` | non-scalar quantities (range, qualitative, approximate, open-ended duration, no author) | synthetic |
| `s4-bell-pepper-rice-skillet.json` | cooking plan (a prerequisite the step performs itself, a unit whose amounts are all qualitative) | self-authored |
| `s4-spaghetti-alla-nerano.json` | cooking plan (a split amount, a reserved amount, a prerequisite the first unit needs) | self-authored |

The two `s4-*` fixtures carry the **shapes** the CFV1-S4 real-device evaluation
found on a phone (`spikes/s4-cooking-ux/README.md`), so the Slice 6 derivation is
exercised against the cases that actually broke rather than against invented
ones. Their instruction text is written here, not transcribed: what is carried
over is functional — which use is a split, which prerequisite a step performs
itself, where a reserved amount sits — and the titles are common dish names. Like
every fixture above they name `Cookframe Fixtures` as their source and record
`example.invalid` URLs, which `tests/fixtures/public-fixtures.test.ts` enforces.
