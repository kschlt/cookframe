# CFV1-S2 — URL & structured-source extraction spike

**Question:** how often is Schema.org/Recipe JSON-LD both *present* and *sufficient* on real recipe
sources? The answer decides the whole shape of the Slice 4 URL adapter — deterministic-first with a
narrow fallback, or a fallback-dominated pipeline with a real LLM dependency.

Spike: everything lives under `spikes/` (outside build, Biome, and the eval harness) and builds
nothing in the product.

## What is measured

Over a corpus of real recipe pages:

1. **Presence** — does the page carry a Schema.org/`Recipe` JSON-LD block at all?
2. **Sufficiency** — when present, does it carry the fields the Canonical Recipe contract needs to
   build a record without inventing (`name`, `recipeIngredient`, `recipeInstructions`,
   `recipeYield`), not merely parse?
3. **Per-field coverage** and **`recipeInstructions` shape**, so the fallback's real job is stated
   per field/shape rather than as one aggregate.

## Method

`measure.py` reads already-fetched raw HTML (kept **private/uncommitted** — third-party page
content) plus the committed `corpus.json`, extracts every `application/ld+json` block, finds
`Recipe` objects (flattening `@graph` and `@type` arrays), and scores field presence. It writes
`results.json` holding only **structural facts** — booleans, counts, shape labels, HTTP status — and
never recipe text, so the observation is pinned in the public repo without copying copyrighted
content.

```bash
# 1) fetch (private): curl each corpus URL with a browser UA into src_NN.html + a status map.
#    (kept in a scratch/private dir; raw pages are NOT committed.)
# 2) measure:
python3 spikes/url-extraction/measure.py \
  --html-dir <private-html-dir> \
  --status <private-status.json>
```

The fetch is deliberately separate and private; only the corpus list, the scorer, `results.json`,
and `FINDINGS.md` are committed.

## Corpus & its limit

`corpus.json` is 18 real sources across 5 languages, drawn from the S6 fixture-catalog research and
chosen to span the *edge cases the contract must survive*, not for JSON-LD friendliness. **Limit,
stated plainly:** WAF-blocked mainstream sites (chefkoch.de, foodnetwork.com, seriouseats,
bbcgoodfood, allrecipes, thekitchn, theguardian) refuse automated fetch and are under-represented —
including chefkoch, a primary real source. Kornelius can extend the corpus by saving those pages'
HTML into the private html dir; the scorer picks them up with no change.

See [`FINDINGS.md`](FINDINGS.md).
