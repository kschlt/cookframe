# `schema/` — the data contract

This directory is the **single source of truth** for the Cookframe data contract. Every
other part of the tree — validation, persistence, the Schema.org / Bring mapping, the eval
harness, the tests — imports the shape from here. There is deliberately no second copy of
the shape anywhere else (recipe-ontology §5; ADR-0006).

## Files

| File | Contract |
| --- | --- |
| `version.ts` | `SCHEMA_VERSION`, pinned as a literal |
| `common.ts` | Shared value objects: `SourceRef`, `ValueExpression`, `DurationExpression`, `Cue` |
| `source-snapshot.ts` | Layer A — the captured source, block by block |
| `canonical-recipe.ts` | Layer B — the normalized, provider-independent recipe |
| `index.ts` | The one import point; re-exports everything above |

Import from the directory root:

```ts
import { CanonicalRecipe, SourceSnapshot, SCHEMA_VERSION } from "../schema/index.js"
```

## Two properties this contract guarantees

- **Types cannot drift from validation.** Types are inferred from the Zod schemas with
  `z.infer`, so the runtime validator and the compile-time types are the same definition.
- **Unknown keys are rejected.** Every object is `.strict()`. This is the structural half
  of the ontology's "do not invent" rule: a field the source did not provide cannot be
  smuggled in.

## Versioning

`SCHEMA_VERSION` is a literal. A `CanonicalRecipe`'s `schemaVersion` must equal it exactly,
so a snapshot written against one version can never be silently read as another. Changing
the shape means bumping the version and migrating — not editing a record of what a past
version was.
