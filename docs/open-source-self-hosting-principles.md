# Cookframe — Open-Source & Self-Hosting Principles

Status: Discovery baseline  
Scope: Product-level constraints for an open-source, self-hosted recipe system. This deliberately avoids prescribing implementation details better decided during build.

## 1. Product posture

The project is developed from day one as a **public open-source product**, even though the first production instance is personal.

The public repository is the product. The maintainer's own deployment is one instance of that product.

Primary V1 deployment model:

> **single-user, self-hosted instance**

V1 is not a hosted multi-tenant SaaS and should not inherit SaaS complexity.

### License

Cookframe is released under the **MIT License**.

The project intentionally favors low-friction use, modification, redistribution and commercial reuse over reciprocal/copy-left obligations. The public repository must include the license from its first public baseline commit.

### Public repository starts with a clean history

Discovery/workbench material may be developed privately first, but the public product repository must be a **new repository with a new Git history**.

Do not convert the private workbench repository into the public product repository.

The first public commit should contain only curated, public-safe baseline artifacts and the MIT license. From that point onward, product development should happen in the public repository unless material is explicitly private instance state or non-public eval data.

## 2. Public core vs. private instance state

### Public product repository

May contain:
- application and adapter code;
- Source/Canonical/Cooking schemas;
- prompts and prompt-composition logic;
- deterministic mappings such as Schema.org/Recipe;
- database migrations;
- public-safe fixtures and eval definitions;
- deployment/reference configuration;
- CI/CD definitions;
- docs;
- iOS Shortcut definition/instructions;
- example configuration with placeholders.

Must not contain:
- API keys, tokens, passwords or credentials;
- personal recipe data;
- production database exports;
- private instance identifiers where avoidable;
- personal cookbook scans/copyrighted pages as public fixtures;
- logs containing private recipe/source data.

### Private instance/state

Runtime recipe data belongs in configured persistence, not the public repository.

An optional private instance repo may contain non-secret deployment overrides or private eval configuration, but it is not the canonical recipe datastore and should not contain plaintext secrets.

Public fixtures should be synthetic, self-authored or permissively licensed. Real personal regression examples may remain private.

A **small public golden fixture/eval set should exist during implementation**, because extraction correctness and the scan-image deletion policy depend on it.

---

## 3. Configuration and credentials

The codebase should pass this test:

> It can be published without exposing credentials or personal instance state.

Principles:
- deployment-varying configuration is external to source code;
- secrets are supplied via environment/provider secret mechanisms;
- commit only placeholder/example configuration;
- distinguish non-sensitive configuration from secrets;
- use least-privilege credentials;
- prefer short-lived/federated deployment credentials where supported;
- never expose model-provider credentials to browser or iOS Shortcut;
- a client may hold only an instance-scoped ingest credential if required.

Configurable concepts may include:
- model provider + model ID;
- provider credential;
- persistence bindings;
- public base URL;
- Bring adapter enablement;
- Cooking Plan generation policy;
- optional kitchen policy such as `assumedAtHand`.

---

## 4. Runtime input security

Public/self-hosted does not mean trusted input.

Recipe URLs, HTML, uploaded images and source metadata are **hostile/untrusted inputs**.

Product-level requirements:
- URL fetching must not provide access to local/private network resources or cloud metadata endpoints;
- restrict accepted URL schemes to those needed for the product;
- bound redirects and re-validate redirect destinations;
- bound response size, content type and processing time;
- validate and bound image uploads;
- do not execute fetched HTML/scripts;
- treat external webpage/file/image content as data, not as trusted model instructions;
- extraction models receive only the minimum context needed for extraction;
- extraction models have no unnecessary tools, arbitrary network access or privileged credentials;
- deterministic validation occurs before model output is persisted or passed to another adapter.

Indirect prompt injection is specifically relevant because recipe webpages/files/images can contain instructions that a model may interpret. The primary mitigation here is a narrow extraction role and strong privilege separation: an extraction model should have nothing valuable it can be tricked into doing beyond producing validated recipe data.

---

## 5. Public-repository security baseline

For the public GitHub repository:
- secret scanning/push protection;
- dependency/code security checks appropriate to the stack;
- fork pull requests cannot deploy or access production credentials;
- production deployment only from trusted refs/workflows;
- least-privilege deployment credentials;
- `SECURITY.md` with a vulnerability-reporting path;
- public CI logs must be safe to expose.

Every committed file, prompt, test snapshot, workflow log and PR discussion should be treated as public.

---

## 6. Self-hosting as a product requirement

README/docs should explain the product before the maintainer's personal deployment.

Supported documentation path:
1. What the product does.
2. Quick start / supported self-hosting path.
3. Configuration and credentials.
4. Data ownership/storage.
5. iPhone/Shortcut integration.
6. Architecture: Source Snapshot → Canonical Recipe → derived projections/adapters.
7. Contributing/extending adapters/providers.

Recommended public docs (filenames not binding):
- `README.md`
- `SELF_HOSTING.md`
- `CONFIGURATION.md`
- `ARCHITECTURE.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `LICENSE`

Before broader public distribution, also resolve:
- data export/backup contract;
- public fixture licensing/provenance;
- contributor guidance;
- dependency/third-party attribution;
- supported self-hosting path;
- public security reporting;
- package/domain/trademark collision checks appropriate to the chosen distribution channels.

---

## 7. Portability without abstraction theatre

The Canonical Recipe model must not depend on Cloudflare, OpenAI, Bring! or one deployment target.

Provider boundaries worth keeping explicit:
- source adapters;
- model provider;
- recipe persistence;
- optional media/object storage;
- shopping/output adapters.

Do not build a generic multi-cloud framework merely because self-hosters may choose another platform.

A reference deployment may use Cloudflare. Portability primarily comes from clean boundaries, standard/versioned data, reproducible deployment and documentation.

---

## 8. Data ownership and portability

A self-hosted user owns the recipe data produced by their instance.

Product requirements:
- documented/versioned Source Snapshot and Canonical Recipe formats;
- explicit migrations;
- data not trapped solely in opaque provider-specific formats;
- a defined export/backup contract before public release, even if a polished export UI is not V1.

---

## 9. Bring adapter: external contract, not core assumption

Bring is an optional output adapter with its own compatibility tests.

Current Bring compatibility behavior must be treated as an external contract that can change. The adapter should test against Bring rather than infer compatibility merely from Schema.org validity.

Product rules:
- distinguish recipe author, source/publisher and site attribution;
- do not fabricate recipe authorship;
- handle a missing-author compatibility state explicitly;
- test quantities, scaling, no-image recipes, token URLs, return navigation **and recipe-sharing behavior** against Bring;
- keep Bring-specific mapping/policies outside Canonical Recipe semantics.

---

## 10. Privacy boundary: private library vs. Bring capability URL

The personal library is private by default.

A Bring-compatible recipe/share URL is a **capability URL**, not private authentication.

Implications:
- recipe content handed to Bring is deliberately disclosed to Bring;
- the URL may appear in Bring/service/server logs;
- anyone who obtains an active capability URL may be able to read that recipe;
- revocation can stop future access but cannot retract data already fetched;
- `noindex` reduces search indexing but is not access control.

Do not make the whole library public to satisfy Bring.

Use a narrow share/import surface with unguessable, revocable per-recipe capability URLs or an equivalent mechanism.

Because Bring may use the recipe URL for return navigation, aggressively expiring the URL can break the desired “back to recipe” experience. Exact token lifetime/auth mechanics remain an implementation/spike decision.

Treat a recipe handed to Bring as potentially **re-shareable through Bring**. The implementation must not rely on the capability URL or equivalent access path remaining confined to the originating user and Bring. Current external evidence does not establish exactly whether Bring propagates the original recipe URL, a Bring deeplink, a copied representation or another link form; that behavior must be verified in the Bring compatibility spike.

Therefore:
- compatibility testing must cover both return navigation and recipe-sharing behavior;
- capability-token lifetime/revocation decisions must assume the access path may leave the original user's device/session;
- the external contract must not expose any broader library access than the single intended recipe capability.

---

## 11. Open-source non-goals for V1

Do not add merely because the repository is public:
- multi-user tenancy;
- hosted accounts/billing;
- organization/RBAC model;
- plugin marketplace;
- generic cloud abstraction layer;
- public recipe social network;
- telemetry platform;
- shared/global pantry inventory service.

---

## 12. Product name

The product name is **Cookframe** and the intended public repository name is `cookframe`.

The name was chosen to remain independent of Bring!, iPhone/Shortcut, scanning/OCR and any one AI/model provider. Those are adapters or current entry points, not the durable product identity.

Before broader distribution through package registries, custom domains or other branded channels, perform appropriate collision/trademark checks for those channels rather than treating the current naming decision as a legal clearance.
