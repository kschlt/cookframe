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

## Findings

Evaluated by the maintainer on a real phone, 2026-09-21 and again 2026-09-22, on all three recipes
in both layouts. Each finding names the decision Slice 6 has to make and states a recommendation, so
Slice 6 need not re-run the spike (proofs: `cooking-ux/hypothesis-a-vs-b`,
`cooking-ux/assumed-at-hand-suppression`, `cooking-ux/step-count-range`,
`cooking-ux/findings-carry-recommendations`).

Three of the findings below are defects the evaluation exposed rather than answers to the three
questions. They are fixed in this prototype, because the fix is what Slice 6 builds against, and each
fix is a **rendering decision over data the conversion already produces** — none of them costs a
second model call.

### 1. Contextual quantities — Hypothesis A vs B

- **Decision for Slice 6:** the default layout for a cooking unit.
- **Observation:** the first pass preferred B. The second pass reversed it, and the reason given was
  seeing what has to be laid out: *"dass man sehen kann, welche Sachen man rauslegt, finden wir doch
  besser"*. The same pass produced a sharper rule than either hypothesis: the block earns its place
  where the step is **time-critical or has something to lay out in advance** — `Simmer` wants the
  rice and the broth in reach because twenty minutes run after it — and not where the step is only
  seasoning, which the action sentence already carries.
- **Cost, measured on this data rather than assumed:** A is free. The quantity is a datum the
  conversion already produces and rendering it is output, not language. B has to write the figure
  *into* a sentence, and a template breaks exactly where only part of an ingredient is used
  ("stir in part of the 5.3 oz Provolone"), so B costs formulation — in the same model response, not
  a second call.
- **Recommendation:** build **A** as the default, and suppress the block on a unit whose amounts are
  all qualitative. Keep **B** as a switch, not as a second pipeline. **B** is better where the amount is
  inseparable from the action and the unit has exactly one of them; that case does not occur in these
  three recipes, so the condition is stated, not measured.
- **Implemented discriminator:** `needsTheBlock(unit)` keeps the block when the unit is time-critical
  **or** carries at least one measurable amount. A measurable amount is one with a figure in it —
  conversion omits a qualitative amount rather than coercing it to a number, so `to taste` and
  `as needed` arrive without one while the split `part of 5.3 oz` keeps its figure. On the sixteen
  units here the two clauses never disagree; the time-critical clause is kept because a time-critical
  unit with only qualitative inputs would otherwise lose a block it should have.

### 2. `assumedAtHand` suppression

- **Decision for Slice 6:** whether suppression is on by default, and what it may touch.
- **Clutter reduced?** *Not reported.* The evaluation did not answer this half, and it is not closed
  by inference here. The seasoning observation in finding 1 points the same way, but it is an
  observation about a cooking unit, not about the FETCH / PREPARE list.
- **Readiness work hidden?** *Structurally unanswerable in this prototype, which is itself the
  finding.* Suppression here strikes ingredient rows through and never removes them, and it never
  touches START NOW (proof: `cooking-ux/assumed-at-hand-suppression`). No readiness **step** could
  disappear, so a pass that saw nothing missing proves nothing about a Cooking Plan whose readiness
  steps are derived rather than transcribed.
- **Recommendation:** ship suppression **off by default**. Turning it on later needs only the
  answer; shipping it on can silently drop a step the cook needed, and §2.3 of `docs/cooking-ux.md`
  already forbids hiding a measured amount, a required state, an advance action or a reservation.
  Registered as `OQ-37`.

### 3. Cooking-unit granularity

- **Decision for Slice 6:** the target unit size, and how the deriver chunks source steps.
- **Observed unit-count range:** min **4** (Bell Pepper Rice Skillet), max **7** (Spaghetti alla
  Nerano); the third recipe sits at 5 (proof: `cooking-ux/step-count-range`).
- **Both failure modes:** neither bound was reached. A wall of paragraph would show as one or two
  units for a whole recipe, and the micro-step failure at fifteen to twenty; the range sits between
  them across recipes of deliberately different complexity, and granularity drew no complaint in
  either pass. The evidence is three recipes, so the range is a floor to build against and not a
  measured limit.
- **Recommendation:** have the deriver target a unit per phase transition, which is what produced
  4-7 here, and treat a recipe that derives fewer than 3 or more than 12 units as worth a second
  look rather than as a hard bound.

### 4. START NOW admitted a step that belongs to its own unit *(defect, fixed)*

- **Decision for Slice 6:** what the deriver may put in START NOW.
- **Observation:** on two of the three recipes START NOW sent the cook to hot fat before the
  preparation that precedes it. Bell Pepper Rice Skillet carried `Heat olive oil in the skillet`
  while unit 1 cuts 1 kg of peppers and **unit 2 heats the oil itself**; Nerano carried
  `Heat frying oil to 150 °C` while 25 oz of zucchini go through the mandoline, with **unit 1 already
  carrying the 150 °C as its own critical parameter**. The two correct entries sit in the same data
  and show the rule: preheating the oven, and bringing the pasta water to a boil.
- **Recommendation:** admit an entry to START NOW only when it is **slow, safe to leave unattended,
  and needed by a later unit than the first**. Fat at frying temperature is none of the three. The
  mechanical test that separates the two groups here is whether the unit that needs the state
  produces it itself: unit 2 heats its own oil, unit 3 does not boil its own pasta water.
- **Implemented as** `admitsToStartNow(entry, unitCount)`. The three properties are declared per
  entry in `recipes.json`, the refused entries stay in the data under `startNowRejected` with the
  reason, and nothing is dropped silently — the prototype says when the rule refused an entry, and
  says when nothing qualified (proof: `cooking-ux/start-now-admission`).

### 5. A qualitative amount was rendered as a quantity *(defect, fixed)*

- **Decision for Slice 6:** how a unit renders an amount that is not a number.
- **Observation:** `to taste` stood in the quantity column, where it reads as a count — the
  evaluation reported it as *"you need two tastes Salt and Pepper"*. On exactly those units the block
  did nothing but repeat the action sentence below it.
- **Recommendation:** never place a qualitative amount in the quantity position. Render the item
  alone, and let the action sentence carry `to taste`. Combined with finding 1 this removes the block
  entirely where every amount on the unit is qualitative; where one measurable amount remains — 200 g
  of cream cheese beside salt, pepper, nutmeg and curry — the block stays and only the qualitative
  rows lose their quantity position.
- **Implemented as** `rowText(ing)` and `carriesAFigure(qty)`, and guarded so that no measurable
  amount is ever dropped and every row a suppressed block would have shown is still named in the
  action sentence (proof: `cooking-ux/now-you-need-block`).

### 6. A fetch line can stand in for a preparation step *(defect, recorded, not fixed in the data)*

- **Decision for Slice 6:** whether FETCH / PREPARE may list something that has to be *made*.
- **Observation:** `vegetable broth, 500 ml` reads as something to take out of a cupboard, and for
  most kitchens it is powder plus water that has to be boiled. That water is slow, safe to leave and
  needed later — so it is precisely what START NOW is for, and precisely the space finding 4 freed by
  removing the oil.
- **Recommendation:** where a listed ingredient is normally *prepared* rather than fetched, the
  preparation belongs in START NOW as its own entry, under the same admission rule as finding 4.
  §2.3 of `docs/cooking-ux.md` already names "water/liquid that must already be boiling/heated" and
  its own example is `Bring 500 ml water to the boil`.
- **Why this prototype does not add it:** the source recipes say `500 ml vegetable broth` and nothing
  about powder. Writing the boiling step into `recipes.json` would put a step in a recipe that its
  source does not have, which is the invention the project forbids. Bell Pepper Rice Skillet
  therefore ships with an empty START NOW and says so on the page. Which form of an ingredient a
  Cooking Plan may assume is a product question and is **not** settled here.

### Still open after this spike

- **`OQ-36` — the split amount.** Nerano unit 6 divides the Provolone, and neither layout says how
  much. Both say `part of 5.3 oz`, because the source does, and the orange reserve line appears in
  **both** layouts, so B does not lose the cue. Whether that is enough at the stove was not answered,
  so the reserve line keeps its own salience and no division is invented.
- **`OQ-37` — the readiness half of suppression**, per finding 2.

## What holds the findings in place

The proofs in `tests/cooking-ux/` run the prototype's **own** script — `loadPrototype()` extracts
the inline `<script>` and evaluates it, so they exercise the shipped `admitsToStartNow`,
`needsTheBlock`, `carriesAFigure` and `rowText` rather than a second copy of them. Each assertion
about a unit reads that unit, never the page, because `salt` also sits in FETCH / PREPARE and a
page-wide search would pass with the row dropped.

Every rule was then re-broken in the shipped files and the suite required to go red. Thirteen
mutations, thirteen reds, `npm run test:cooking-ux`:

| # | Mutation | Failing proof |
|---|---|---|
| 1 | the oil is put back into START NOW as a qualifying entry | `start-now-admission` |
| 2 | the admission rule admits everything | `start-now-admission` |
| 3 | the quantity position takes a qualitative amount again | `now-you-need-block` |
| 4 | the block is given to every unit again | `now-you-need-block` |
| 5 | the block is taken from every unit | `now-you-need-block` |
| 6 | a figure counts as qualitative | `now-you-need-block` |
| 7 | suppression removes the row instead of marking it | `assumed-at-hand-suppression` |
| 8 | suppression reaches START NOW | `assumed-at-hand-suppression` |
| 9 | a refusal happens silently | `start-now-admission` |
| 10 | a finding loses its recommendation | `findings-carry-recommendations` |
| 11 | a finding is left as a placeholder | `findings-carry-recommendations` |
| 12 | the stated unit-count range drifts from the data | `step-count-range` |
| 13 | an open question goes unregistered | `findings-carry-recommendations` |

## Reproducing / extending the recipe set

Add real recipes to `recipes.json` (format documented by example in the file), then re-embed the
same JSON into `prototype.html`'s `#recipe-data` block. Use recipes with a genuine split/reserve and
real prep prerequisites — those exercise the salience and readiness hypotheses.
