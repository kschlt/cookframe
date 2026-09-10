# Cookframe — Source & Output Adapter Architecture

Status: Discovery baseline  
Scope: Product-level boundaries between heterogeneous inputs, the recipe core and downstream outputs.

## 1. Core principle

Cookframe should not be organized around one input format or one downstream product.

```text
                  INPUT ADAPTERS
             ┌────────┼────────┐
             │        │        │
           image     URL     future
             │        │        │
             └────────┼────────┘
                      ↓
               Source Snapshot
                      ↓
               Canonical Recipe
                      ↓
             ┌────────┼─────────┐
             │        │         │
          recipe UI  Schema   shopping
                     adapter    adapter
```

Capture is source-specific. Normalization is shared. External mappings remain outside Canonical.

## 2. Image source adapter

Purpose: convert a photo, screenshot or scanned recipe page into a Source Snapshot.

Product constraints:

- the image is untrusted input;
- multimodal extraction should capture all recipe-relevant visible information and document structure;
- the captured representation is durable but is not equivalent to the original pixels;
- source image deletion is intended only after the capture-quality release gate passes;
- the scan/cookbook page is not automatically a recipe hero image;
- the image processing path must not expose privileged tools or unrelated secrets to the extraction model.

The exact model/provider and physical upload mechanism remain implementation decisions.

## 3. URL source adapter

Purpose: import an existing web recipe without unnecessary vision/LLM work.

Preferred sequence:

1. fetch the URL as hostile external input;
2. detect structured recipe payloads such as Schema.org/Recipe JSON-LD;
3. preserve relevant structured source payload and recipe text in the Source Snapshot;
4. use deterministic mapping where reliable;
5. fall back to recipe-relevant DOM/text extraction when needed;
6. use LLM assistance only where deterministic extraction is insufficient.

Runtime fetching must account for:

- SSRF/network-boundary protection;
- redirects;
- content-type and size limits;
- script execution avoidance;
- indirect prompt injection;
- untrusted external images.

The exact safe-fetch implementation is intentionally deferred.

## 4. Future source adapters

Possible later inputs include:

- plain text;
- share-sheet text;
- other recipe applications;
- structured recipe files.

A new adapter should converge into the same Source Snapshot contract rather than bypassing the recipe core.

## 5. Hero media is separate from source evidence

Cookframe distinguishes:

### Source asset

Evidence used for capture, such as a photographed cookbook page.

V1 direction: transient; not retained after the capture-quality policy permits deletion.

### Hero media

Optional finished-dish media used for discovery/library presentation.

Possible sources:

- source-provided web recipe image;
- later user-supplied image.

Hero media is not recipe ground truth.

If retained, it may be normalized/compressed deterministically before object/blob storage. Exact media format, storage target and variant strategy remain implementation decisions.

## 6. Recipe UI adapter/projection

HTML is generated from stored recipe data; it is not the durable source of truth.

A recipe page may expose:

- discovery information;
- shopping action;
- preparation/readiness information;
- active-cooking presentation;
- optional source attribution;
- optional hero media.

The exact front-end technology is not part of this discovery baseline.

## 7. Schema.org adapter

Schema.org/Recipe is an interoperability mapping, not the core ontology.

Rules:

- map only representable canonical facts;
- do not invent data solely to satisfy an external schema;
- preserve information losslessly in Canonical even when an external schema is less expressive;
- non-representable qualitative/range time values must not be coerced into invented ISO durations;
- adapter behavior should be versioned/tested when external expectations change.

## 8. Bring adapter

Bring is the first intended shopping adapter, not a product dependency.

Product-level invariants:

- valid Schema.org alone is not assumed to imply Bring compatibility;
- authorship is not fabricated if a source does not provide it;
- Bring-specific scaling behavior must not override Canonical scaling semantics;
- requested/base quantity behavior must be verified against Bring;
- tokenized/shareable recipe URLs and return navigation must be tested;
- sharing behavior must be treated as part of the external contract;
- a recipe passed to Bring must be considered potentially re-shareable;
- the private library must not be made public to satisfy Bring.

Exact integration mechanics remain a compatibility-spike outcome.

## 9. Capability URL boundary

If an external adapter needs a fetchable recipe URL, that URL should expose only the specific recipe capability required by that adapter.

It is not equivalent to private user authentication.

The exact token format, lifetime, revocation model and propagation behavior remain implementation decisions informed by the Bring compatibility spike.

## 10. Adapter design rule

Adapters may translate representation.

They must not silently change culinary meaning.

When an external target cannot express a Canonical distinction safely, the adapter should omit/disable that behavior or surface incompatibility rather than fabricate a lossy interpretation.
