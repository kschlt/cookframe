# Cookframe — Product Vision & Scope

Status: Discovery baseline  
Scope: Product intent, jobs-to-be-done, V1 boundaries and future-readiness principles.

## 1. Product vision

Cookframe converts recipes from heterogeneous sources into one consistent, durable recipe representation and then presents the minimum sufficient information for the user's current job.

The durable value proposition is not:

> scan a recipe into one shopping app.

It is:

> **Any recipe source → one canonical recipe model → consistent discovery, shopping, preparation and cooking experiences.**

Shopping integrations are outputs. AI providers are processing choices. Hosting is infrastructure. None of them defines the product's core model.

## 2. Problem

Recipes contain recurring kinds of information — title, yields, ingredients, quantities, steps, times, temperatures, notes, equipment and metadata — but every source presents them differently.

That creates avoidable work:

- mentally translating different recipe structures;
- repeatedly jumping between ingredient lists and steps;
- reading ahead to avoid late surprises;
- remembering which part of a split ingredient is needed now and later;
- re-entering ingredients into shopping tools;
- losing access to recipes when the original book/site is not available.

Cookframe provides a stable recipe layer between heterogeneous sources and downstream uses.

## 3. Primary V1 user journeys

### 3.1 Scan and shop now

```text
mobile shortcut/share
→ image import
→ capture + normalization
→ recipe saved
→ shopping adapter opens
```

The critical requirement is low friction. High-quality cooking optimization must not block this flow.

### 3.2 Scan and save

```text
mobile shortcut/share
→ image import
→ recipe saved
→ optional recipe page/library
```

The recipe can later be used without rescanning.

### 3.3 Import an existing recipe URL

```text
recipe URL
→ structured extraction first
→ fallback extraction only when needed
→ same normalization pipeline
```

Existing structured recipe data should be used deterministically where possible.

### 3.4 Browse the recipe library

The library should help answer quickly:

- Do I want to cook this?
- How long will it take?
- Are there long waits/rests/marinades?
- Is unusual equipment needed?
- What is the dish broadly made of?

A source-provided hero image may support discovery.

### 3.5 Shop from a stored recipe

Any stored recipe can expose its shopping requirements through an output adapter such as Bring.

### 3.6 Prepare to cook

Before active cooking, Cookframe should reduce avoidable surprises:

- what must be fetched;
- what requires measurement or reservation;
- what equipment is needed;
- what needs advance action such as preheating, thawing, soaking, boiling or resting.

### 3.7 Active cooking

The user should be able to work top-to-bottom with minimal searching.

The current work unit should expose the information needed to act safely and confidently, while nearby future structure remains discoverable.

### 3.8 Reprocess the library

Improved prompts, models or ontology versions should be able to re-normalize stored Source Snapshots and regenerate derived Cooking Plans without re-importing every source.

## 4. Four information jobs, not four required modes

The product distinguishes four jobs:

1. **Discovery:** “Do I want to cook this?”
2. **Shopping:** “What do I need overall?”
3. **Preparation:** “What must I fetch, prepare or start before cooking?”
4. **Active Cooking:** “What do I need and do now, and what is coming next?”

These are projection policies over the same Canonical Recipe. They do not require four explicit screens or navigation modes.

## 5. Future-readiness principle

> **Preserve broadly; canonicalize deliberately; derive separately.**

### Preserve broadly

Source Snapshot should retain recipe-relevant information even when V1 does not yet model or display it.

### Canonicalize deliberately

Common, source-grounded recipe facts whose semantics are well understood may belong in Canonical even when no V1 feature uses them yet.

Examples include source-provided:

- nutrition with reference basis;
- cuisine;
- category / meal type;
- diet;
- difficulty;
- keywords;
- equipment;
- multiple contextual yields.

### Derive separately

System judgments and user-specific interpretations remain separate derived enrichment or instance state.

Examples:

- “healthy”;
- recommendation scores;
- inferred vegetarian status;
- weeknight suitability;
- embeddings;
- personal preferences;
- meal plans.

Future-readiness is not permission to build a speculative universal recipe ontology.

## 6. V1 non-goals

V1 intentionally does not implement:

- multi-user SaaS or organization tenancy;
- social recipe features;
- recommendation engine;
- weekly meal planning;
- nutrition-driven recommendations or health scoring;
- inventory/pantry stock tracking;
- automatic purchasing;
- generalized semantic food ontology;
- generalized unit-conversion engine;
- generalized recipe scheduling/parallelization optimizer;
- agentic meal planning;
- full prepared-food/intermediate-state graph;
- native iOS application;
- step photography/icon library;
- end-user review workflow for every import.

Source-provided facts that could enable some of these later may still be preserved or normalized.

## 7. Product success for the first implementation

A first useful Cookframe should demonstrate that:

- heterogeneous sources can converge into one recipe model;
- common recipe facts are preserved without fabrication;
- image and URL imports share the same normalization core;
- stored recipes remain usable independently of the original source;
- shopping export works through a separately verified adapter;
- the mobile cooking presentation materially reduces searching and mental reconstruction;
- the system can be self-hosted without exposing provider credentials to the mobile input client;
- future reprocessing does not require re-importing every recipe source.
