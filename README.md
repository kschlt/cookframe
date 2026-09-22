# Cookframe

> Turn recipes from anywhere into one consistent, cookable format.

**Cookframe** is an open-source, self-hosted recipe system designed to normalize recipes from heterogeneous sources into one durable recipe model and present the right information for choosing, shopping, preparing and cooking.

## Status

Cookframe is in early development.

This repository begins with a product and architecture baseline. Implementation details are intentionally not frozen yet; they will be decided incrementally against the constraints and validation gates documented in `docs/`.

## Why Cookframe

Recipes arrive in many forms:

- cookbook photos;
- screenshots;
- recipe websites;
- structured web recipes;
- eventually other text/share inputs.

Their information is usually similar, but the structure, wording and presentation vary significantly.

Cookframe aims to convert those sources into:

```text
untrusted source
      ↓
Source Snapshot
      ↓
Canonical Recipe
      ↓
context-specific projections and adapters
```

The Canonical Recipe is the durable center. Shopping integrations, cooking presentation, AI providers, hosting and external schemas remain replaceable concerns around it.

## Core product ideas

- **Source-faithful capture:** preserve a durable textual/structured capture record.
- **Canonical recipe facts:** normalize common source-grounded facts without inventing information.
- **Derived cooking experience:** optimize presentation for low-stress execution without rewriting the recipe.
- **Context-aware information:** discovery, shopping, preparation and active cooking need different projections of the same recipe.
- **Adapter architecture:** images and URLs are input adapters; Schema.org and Bring are output adapters.
- **Reprocessing:** newer models, prompts or ontology versions can re-normalize stored source captures.
- **Future-ready data, small V1:** preserve broadly, canonicalize deliberately, derive separately.
- **Self-hosted by default:** each user runs their own instance and controls their own credentials and data.

## V1 direction

The first useful product should make it possible to:

1. import a recipe from an image or recipe URL;
2. preserve a Source Snapshot and normalize it into a Canonical Recipe;
3. save and browse a personal recipe library;
4. render a consistent mobile-first recipe page;
5. support low-friction shopping through a separately tested Bring adapter;
6. support a derived cooking-oriented presentation without changing recipe facts.

The exact technology stack, hosting target, model provider and visual component implementation are intentionally deferred until implementation discovery.

## Documentation

See [`docs/`](docs/) for the product and architecture baseline, the decision records, and the open
questions.

## License

Cookframe is licensed under the
[GNU Affero General Public License, version 3 or later](LICENSE). You may run it, read it, change
it and pass it on. If you change it and offer it to other people over a network, you have to offer
them your changed source too.

Copyright in the project is held by its maintainer, who is therefore also free to license the same
code on other terms. That is why [`CONTRIBUTING.md`](CONTRIBUTING.md) asks an outside contributor
to agree to the same, before their first change is merged.
