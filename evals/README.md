# `evals/` — the eval harness

The harness (`harness.ts`) validates every committed public fixture against the one
contract in `schema/` and exits non-zero on any failure, so both `npm run eval` and CI fail
loudly on a regression.

```bash
npm run eval
```

Today its job is small: prove the harness runs and the contract is enforceable. Later
slices grow it into the real capture / normalization eval that measures how faithfully a
source is turned into a Canonical Recipe.

## Fixtures: public vs. private

```
evals/fixtures/
  public/     committed — synthetic, safe to share, run in CI
    canonical/
    source-snapshot/
  private/    git-ignored — real photos, personal recipes, never committed
```

- **`public/`** holds synthetic fixtures with no real personal data. These are committed
  and are what CI runs against. `canonical/two-yields-nutrition.json` is the ontology's
  future-readiness case (recipe-ontology §12): two contextual yields, an ambiguous
  per-serving nutrition basis, and source-provided classifications.
- **`private/`** is git-ignored (see the repository `.gitignore`). Real cookbook photos and
  personal recipes stay out of the public repository entirely; this instance holds only
  configuration and pointers, never the private material itself.

To add a public fixture, drop a JSON file into `public/canonical/` (validated against
`CanonicalRecipe`) or `public/source-snapshot/` (validated against `SourceSnapshot`). The
harness discovers it automatically.
