# CFV1-S4 — Cooking UX hypotheses spike

Three untested hypotheses sit under the Cooking Plan's presentation (`docs/cooking-ux.md` §3, §11).
Each fails only with **real recipes on a real phone** — a desktop browser or a synthetic recipe
would not reproduce the failure modes, so the spike's prerequisite is exactly that (`What NOT`).

This directory delivers the **prototype prerequisite** so the owner-only half — the real-device
evaluation — is a ten-minute task rather than a build. The prototype is throwaway by design;
polish would bias the result.

## What's here

- **`prototype.html`** — one self-contained file: plain HTML + CSS + vanilla JS, **no dependency
  manifest and no build step** (proof: `cooking-ux/plain-html-prototype`). Open it directly.
- **`recipes.json`** — the recipes it renders, held as **functional data only** (quantities, action
  verbs, splits, prerequisites, phases — facts/procedures, not creative prose), each with its source
  URL. Real recipes, transcribed as facts, so nothing copyrightable is committed to a public repo
  (the same discipline as the S2 spike).

The prototype embeds a copy of this data in its `#recipe-data` block so it works from `file://`
with no server; `recipes.json` is the reviewable source of that data.

Three real vegetarian recipes ship, chosen to span the hypotheses and complexities:

- **Bell Pepper Rice Skillet** (gaumenfreundin.de) — the simple one, 4 units.
- **Spaghetti alla Nerano** (giallozafferano.com) — 7 units; carries the genuine **split/reserve**
  (Provolone stirred in off-heat, the rest sprinkled on top; pasta water saved) that tests
  reservation salience.
- **Gnocchi and Pumpkin Bake** (gaumenfreundin.de) — 5 units; the clearest **prep prerequisite**
  (preheat oven, in START NOW, never suppressed).

## How to run the evaluation (owner, on a phone)

1. Get `prototype.html` onto a phone — AirDrop / email / Files, or serve the directory
   (`python3 -m http.server` in this folder, then open `http://<computer-ip>:8000/prototype.html`
   over the same network). A single-file open needs no server.
2. For **each** recipe (picker at the top), do the three comparisons below. The controls:
   - **A · NOW YOU NEED / B · inline** — the same recipe, quantities in a separate block vs woven
     into the action prose.
   - **Hide at-hand basics** — toggles `assumedAtHand` suppression of retrieval reminders in
     FETCH / PREPARE.

### The three questions to answer (`docs/cooking-ux.md` §11)

1. **Hypothesis A vs B (contextual quantities).** Cooking each unit for real, which layout do you
   actually use, and where does the other fail? A tends to fail by pushing the action below a block;
   B tends to fail by burying the quantity mid-sentence. Name the winner **and** the conditions
   under which the other is better.
2. **`assumedAtHand` suppression — both halves, separately.** With suppression on: did clutter
   genuinely fall? AND did any real readiness step disappear with the basics? (This is the one most
   likely to be half-right — clutter falls while a needed step goes missing.) The prototype never
   suppresses START NOW; the check is on FETCH / PREPARE. Report the two halves as two outcomes.
3. **Cooking-unit granularity.** Did the units read as a wall of paragraph, or explode into 15-20
   micro-steps? The unit count is shown per recipe. Record the observed range as a **minimum and a
   maximum** across the recipes.

## Findings (fill after the phone test — this is the S4 deliverable)

Each finding must name the decision Slice 6 has to make and state a recommendation, so Slice 6 need
not re-run the spike (proofs: `cooking-ux/hypothesis-a-vs-b`, `cooking-ux/assumed-at-hand-suppression`,
`cooking-ux/step-count-range`, `cooking-ux/findings-carry-recommendations`).

### 1. Contextual quantities — Hypothesis A vs B
- Decision for Slice 6: default layout for a cooking unit.
- Observation: _pending real-device evaluation_
- Recommendation: _pending_ (name the preferred layout and when the other wins)

### 2. `assumedAtHand` suppression
- Decision for Slice 6: whether suppression is on by default, and what it may touch.
- Clutter reduced? _pending_
- Readiness work hidden? _pending_ (must be reported separately from the clutter half)
- Recommendation: _pending_

### 3. Cooking-unit granularity
- Decision for Slice 6: target unit size / how the deriver chunks steps.
- Observed unit-count range: min _pending_, max _pending_
- Recommendation: _pending_

## Reproducing / extending the recipe set

Add real recipes to `recipes.json` (format documented by example in the file), then re-embed the
same JSON into `prototype.html`'s `#recipe-data` block. Use recipes with a genuine split/reserve and
real prep prerequisites — those exercise the salience and readiness hypotheses.
