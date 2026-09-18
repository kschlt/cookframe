# Bring compatibility — findings (CFV1-S3)

Evidence for the capability-URL design (OQ-17), the Slice 3 Schema.org mapping, and the
hosting decision (OQ-05). One verdict-bearing section per enumerated question. Each verdict
states what was **observed** against Bring, not what its documentation claims.

## How this was observed

Bring imports a recipe by opening a deep link whose payload is a call to
`https://api.getbring.com/rest/bringrecipes/parser?url=<recipe url>`. That endpoint fetches
the recipe URL **server-side from Bring's own infrastructure** and returns Bring's parse as
JSON — the same structure the app then renders. So the parser output is a faithful proxy for
what the app imports, and it is what the `fixtures/*.json` files pin. Recipe sources are the
disposable pages under `pages/`, served from `raw.githubusercontent.com`.

Two halves. Everything the parser returns is recorded automatically by `record.py` and pinned
in `fixtures/`; the verdicts below marked **(API)** rest on that. The verdicts marked
**(app — pending)** live in the Bring UI, not in the HTTP response — how it renders, its
return navigation, and what a Bring-side share propagates — and need a phone. The observation
kit for that is `protocol.md`; those verdicts are stated as the API evidence constrains them
and are confirmed on device.

Observation date: 2026-09-18. Pages pinned at commit recorded in each fixture's
`pages_pinned_at`.

---

## Q1 — Missing author: required or tolerated?

**Verdict (API): tolerated. Author is optional, and Bring does not fabricate one.**

- With the `author` field absent (`missing-author.html`) the import succeeds and `author` is
  simply absent from the response.
- With `author` present but an empty string (`empty-author.html`) the response also carries no
  `author` — an empty author is normalised to none, not echoed and not invented.
- Control (`baseline.html`) carries `author: "Cookframe Fixture"`.

Fixture: `bring-compat/missing-author`. **Adapter rule:** author is optional end to end; Cookframe
must never synthesise an author to satisfy Bring. The app-side rendering of a missing author
(blank vs. placeholder) is the one open point — `protocol.md` Q1.

## Q2 — Ingredient parsing: what is accepted, and how is a line split?

**Verdict (API): Bring parses every non-empty line into an item, splitting a leading
quantity+unit into `spec` and the remainder into `itemId`. It is lossy in specific,
recorded ways.**

From `ingredient-parsing.html` (`bring-compat/ingredient-parsing`, case `line-shapes`):

- Leading `quantity [unit]` becomes `spec`; the rest becomes `itemId`. `"200 g Mehl"` →
  `spec:"200 g"`, `itemId:"Mehl"`.
- Decimal comma and point both parse: `"1,5 l"`, `"0.5 kg"` kept verbatim in `spec`.
- Fractions parse, including the unicode vulgar fraction: `"1/2 TL"` and `"½ TL"` (the latter
  normalised to `"1⁄2 TL"`).
- A **trailing qualifier after a comma is folded into `spec`, not dropped and not kept with the
  name**: `"3 EL Olivenöl, kaltgepresst"` → `itemId:"Olivenöl"`, `spec:"3 EL, kaltgepresst"`;
  same for `"100 g Butter (weich)"` → `spec:"100 g, weich"` and `"1 Bund Petersilie, fein
  gehackt"` → `spec:"1 Bund, fein gehackt"`. The parenthetical `(weich)` loses its brackets.
- A line with **no leading number** becomes an item with `spec:null` and the whole line as the
  name: `"Saft einer halben Zitrone"`, `"Mehl zum Bestäuben"`, `"Salz und Pfeffer"` (the last is
  **one** item, not two).
- **A leading count with a mid-line unit mis-splits**: `"2 Dosen à 400 g Tomaten"` →
  `itemId:"Dosen à 400 g Tomaten"`, `spec:"2"`. Bring anchors on the first number only; the
  `400 g` inside the line is lost as structure.
- Bring attaches a category guess (`altIcon`, `altSection`) to many items, sometimes wrong
  (`"Öl zum Braten"` → icon "Fleisch"; `"Saft einer halben Zitrone"` → section "Getränke &
  Tabak"). These are Bring-side enrichment, not from the source.

Fixture: `bring-compat/ingredient-parsing`. **Adapter rule:** Cookframe should hand Bring one
ingredient per line as `"<quantity> <unit> <name>"` with the name last and no leading count
without its own unit; qualifiers after a comma survive but land in `spec`; a name-only line is
accepted but unquantified. Do not rely on Bring's category guess.

## Q3 — Exact vs vague vs ranged quantities

**Verdict (API): exact quantities parse cleanly; vague amounts survive as an unquantified or
free-text item (never dropped); ranges are preserved verbatim in `spec` but a range with a
mid-line word can mis-split.**

- **Exact** (`quantity-exact.html`): every line splits to a clean `spec` + `itemId`.
- **Vague** (`quantity-vague.html`): `"etwas Salz"` → `spec:"etwas"`; `"eine Prise Muskat"`,
  `"eine Handvoll Basilikum"`, `"Pfeffer nach Geschmack"`, `"Öl zum Braten"`, bare `"Mehl"` →
  `spec:null`, whole phrase as name. Nothing is dropped, but nothing is numerically scalable.
- **Ranged** (`quantity-ranged.html`): `"2-3 EL Olivenöl"` → `spec:"2-3 EL"`; `"400–500 g
  Mehl"` → `spec:"400–500 g"` (en-dash kept); `"2 - 3 Zwiebeln"` → `spec:"2 - 3"`; `"½–1 TL
  Zimt"` → `spec:"1⁄2–1 TL"`. But `"1 bis 2 TL Senf"` mis-splits to `itemId:"bis 2 TL Senf"`,
  `spec:"1"` — the word "bis" defeats the leading-number split.

Fixture: `bring-compat/quantity-classes` (three distinguishable cases). **Adapter rule:** emit
ranges with a dash (`2-3`, `400–500`), never the word "bis"/"to". Vague amounts round-trip as
text but will not scale — Cookframe must decide whether to pass them through or resolve them
before export. Scaling behaviour for these classes on device is `protocol.md` Q3.

## Q4 — Multiple contextual yields, and scaling base

**Verdict (API): Bring scales linearly from a single `baseQuantity`. It adopts the first
declared yield as base; extra contextual yields are ignored; scaling is driven by the
requested quantity, computed from base, not from the requested figure directly.**

- `multi-yield.html` declares `["4 Portionen","12 Muffins","1 Blech"]`; the parser adopts
  `yield:"4 Portionen"`, `baseQuantity:4` — **only the first**; the others vanish.
- `no-yield.html` (no `recipeYield`): `yield:null` but `baseQuantity:4` still appears, and
  scaling still works — Bring defaults the base when none is given.
- `yield-bare-number.html` (`recipeYield:"6"`): `yield:"6"`, `baseQuantity:6`.
- Scaling is linear from base. `baseline.html` (base 4) requested at 8 → all quantities ×2
  (`800 g`→`1600 g`, `1 TL`→`2 TL`, `1`→`2`); requested at 2 → ×0.5 (`800 g`→`400 g`,
  `1`→`0.5`, `1 TL`→`0.5 TL`). Fractional results are emitted as decimals (`0.5`), not fractions.
- The scale factor is `requested / base`, not `requested` absolute: with `baseQuantity=2`
  forced and `requestedQuantity=8`, quantities go ×4 and `yield` reads `"16 Portionen"` — Bring
  applies factor 4 (=8/2) and relabels the yield by the same factor.

Fixture: `bring-compat/multi-yield-scaling` (7 cases). **Adapter rule:** Cookframe must pick a
**single** canonical yield to send as the base — Bring will silently discard the rest — and can
rely on linear scaling from it. If Cookframe wants a specific serving count in Bring, send it as
the requested quantity against the true base. The base Bring adopts on device is confirmed in
`protocol.md` Q4.

## Q5 — No-image recipe

**Verdict (API): a recipe with no image imports cleanly (`imageUrl` omitted). Bring measures a
reachable image correctly, but does NOT validate reachability — a dead image URL is echoed with
a fixed 1024×576 fallback size.**

- `no-image.html` (no `image`): response has no `imageUrl`, `imageWidth`, `imageHeight`.
- `broken-image.html` (image URL that 404s): the parser **echoes the dead URL** as `imageUrl`
  with a **fixed fallback `1024×576`** — Bring does not fetch the image to confirm it exists and
  invents a size.
- `baseline.html` control (image resolvable, pinned to its commit): reported at its **true
  640×360** — so Bring *does* measure a reachable image accurately; the 1024×576 is specifically
  its unreachable-image fallback.

Fixture: `bring-compat/no-image` (absent / dead-URL / resolvable-control, three distinguishable
cases). **Adapter rule:** omit the image field rather than send a URL Cookframe is unsure of — a
dead URL is accepted silently, gets a fake 1024×576 size, and renders as a broken image in the
app. Send only known-reachable image URLs; when one is sent, Bring's reported dimensions can be
trusted. The on-device rendering of a no-image and a broken-image recipe is `protocol.md` Q5.

## Q6 — Tokenized URL and return navigation

**Verdict (API): an unguessable *path* works exactly like a plain URL, so a capability URL is
importable — but only if the secret is in the path. A token in the *query string* breaks the
import.**

- `t/9f2c…/recipe.html` (secret in the path) imports identically to `baseline.html`: full parse,
  `linkOutUrl` echoes the source URL.
- The **same URL with `?token=…` appended fails with HTTP 400** ("recipe url is not reachable …
  httpStatus=404"). This is a GitHub Pages/raw artefact (the query 404s there), but the
  operative finding for OQ-17 is that **Bring forwards the URL as given and does not strip or
  preserve a query token by itself** — whether a query token survives depends entirely on the
  host, so a capability URL must carry its secret in the **path**, not the query.
- Bring echoes the source URL in `linkOutUrl` — so the source URL **is** retained by Bring and
  surfaced back. Its exposure in the app UI, and the return navigation the user gets, is the
  privacy-adjacent open point — `protocol.md` Q6.

Fixture: `bring-compat/tokenized-url`. **Adapter rule (OQ-17):** put the capability secret in the
URL path, never the query string. Note that Bring stores and re-surfaces the full source URL
(`linkOutUrl`), so the capability URL is not single-use from Bring's side — treat it as a
bearer token that Bring retains.

## Q7 — What a Bring-side share propagates (the privacy question)

**Verdict (app — pending; API strongly constrains it): the deep link Bring generates is an
opaque OneLink shortlink that does NOT expose the source URL. Whether a *share* carries the
recipe contents or a re-openable link is the on-device half.**

- The deep link `record.py` captured for both `baseline.html` and the capability-URL page is a
  302 to `https://getbring.onelink.me/ZAzR/<opaque>` — a different opaque code each call, with
  **no source URL recoverable from the shortlink** (`source_url_recoverable_from_share_link:
  false` in the fixture). So the *import* deep link does not leak the source URL to a third party.
- **But** the parser retains `linkOutUrl` = the full source URL (Q6). The open question is
  whether Bring's own *share* of an imported recipe re-exposes that `linkOutUrl` or the
  capability URL to the recipient. This cannot be answered from HTTP alone and is the single most
  important on-device observation — `protocol.md` Q7, designed so a negative answer is as well
  evidenced as a positive one.

Fixture: `bring-compat/share-propagation` (import deep links pinned; device observations pending).
**Provisional adapter rule:** assume, until the device observation confirms otherwise, that a
capability URL handed to Bring **may** be propagated by a Bring-side share, because Bring retains
it as `linkOutUrl`. Design OQ-17's token lifetime/revocation for that worst case.

---

## Consolidated adapter constraints for Slice 3

1. Author is optional; never fabricate one.
2. One ingredient per line, `"<qty> <unit> <name>"`, name last; no leading count without its own
   unit (`"2 Dosen à 400 g Tomaten"` mis-splits). Comma-qualifiers survive but land in `spec`.
3. Ranges use a dash (`2-3`), never "bis"/"to". Vague amounts round-trip as text but do not scale.
4. Send exactly one canonical yield as the base; Bring discards extra yields. Scaling is linear,
   factor = requested/base; fractions emit as decimals.
5. Omit the image field unless the URL is known-good; Bring does not validate it. Do not trust
   Bring's reported image dimensions.
6. Capability secret goes in the URL **path**, never the query. Bring retains the full source URL
   as `linkOutUrl`, so treat the capability URL as a retained bearer token.
7. The import deep link is opaque and does not leak the source URL; a Bring-side *share* might —
   confirm on device (Q7) and design token revocation for the worst case.

## Documented vs observed — where they diverge

The most valuable outputs, per the spike's own hint:

- Bring **folds comma-qualifiers and parentheticals into `spec`** rather than keeping them with
  the ingredient name or dropping them — not something the import docs state.
- Bring **silently discards all but the first `recipeYield`** — a multi-yield recipe loses its
  alternate yields with no error.
- Bring **does not validate the image URL**: a dead URL is echoed with an invented fixed
  1024×576 size, while a reachable image is measured accurately — so a "wrong" dimension is the
  tell that Bring could not fetch the image.
- The word **"bis" in a range defeats parsing** where a dash does not.
