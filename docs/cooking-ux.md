# Cookframe — Cooking UX & Transformation Principles

Status: Discovery baseline; exact interaction design remains an evaluation task  
Scope: Product/interaction principles for recipe discovery, shopping, readiness and active cooking. Exact visual design remains an evaluation task.

## 1. Goal

The system should reduce cognitive load across the recipe lifecycle without changing the recipe itself.

Core goal:

> The user should be able to move from choosing a recipe through shopping, preparation and cooking with the minimum sufficient information for the current job, without repeatedly reconstructing the recipe mentally or searching between distant sections.

The UX is mobile-first, but the information model should adapt naturally to larger screens.

---

## 2. Four information jobs, not four required UI modes

The product supports four distinct jobs. These are **projections of one Canonical Recipe**, not definitions of which facts deserve to be stored canonically. Canonical may preserve source-grounded facts that V1 does not yet show or act on.

### 2.1 Discovery / selection

Question: **“Do I want to cook this?”**

Prioritize:
- hero image when available;
- title;
- source-grounded total/active/passive time when available;
- yield/servings;
- feasibility signals such as overnight rest, long marination, unusual equipment or major sub-components;
- concise ingredient identity/context;
- source-provided classifications where useful.

Do not force the full ingredient list or detailed execution steps into the first glance.

### 2.2 Shopping / planning

Question: **“What do I need in total?”**

Prioritize:
- complete ingredient requirements;
- recipe-scale quantities;
- deterministic scaling when explicitly eligible;
- ingredient grouping when it aids comprehension;
- output to Bring or another shopping adapter.

`assumedAtHand` never removes recipe truth from Shopping. A later user-specific shopping policy may decide what not to purchase, but the recipe requirement remains complete.

### 2.3 Preparation / readiness

Question: **“What must be ready so I can cook without surprises?”**

Preparation is a pre-flight, not merely a filtered ingredient list.

It should surface:
- equipment that must be found/set up;
- ingredients that must be fetched;
- ingredients/components that require advance measurement, division or reservation;
- preheating;
- thawing;
- soaking;
- marination/resting that blocks later progress;
- water/liquid that must already be boiling/heated;
- other source-grounded prerequisites.

Instance policy such as `assumedAtHand` may suppress **retrieval reminders** for basics such as salt, pepper, water or common oil.

It must **not** hide:
- a required measured amount;
- a required preheated/boiling state;
- an advance preparation action;
- a split/reservation requirement;
- anything needed in the current cooking unit.

Example:

```text
BEFORE YOU START

SET UP
• Air fryer
• Large bowl

START NOW
• Preheat air fryer to 200 °C
• Bring 500 ml water to the boil

FETCH / PREPARE
• Jackfruit
• Mushrooms
• Miso
• Reserve 1 tbsp dressing for later
```

Salt may be omitted from “fetch” if configured as at hand, but `½ tsp salt` still appears when it must be measured/added.

### 2.4 Active cooking

Question: **“What do I do now, what matters now, and what comes next?”**

The interface should make the following easy to perceive without searching:
- current position / sub-goal;
- current action;
- ingredient/component quantities relevant now;
- split/reservation warnings;
- time, temperature, doneness or wait cues that matter now;
- safe look-ahead/prerequisite cues;
- nearby future structure.

---

## 3. Information invariants for an active cooking unit

A meaningful cooking unit is the primary execution chunk. It is larger than an atomic micro-step and smaller than an unstructured recipe paragraph.

Each unit may contain:

```text
CookingUnit
- orientation / phase
- action(s)
- ingredient/component uses
- critical parameters
- reservation/hold-back cue
- safe parallel/look-ahead cue
- deterministic next-unit context
- source/canonical references
```

The **information requirements are fixed; the exact visual order is not**.

Two layouts should explicitly be evaluated:

### Hypothesis A — compact contextual inputs first

```text
2 — Prepare the filling

NOW YOU NEED
400 g jackfruit · 100 g of 250 g mushrooms

Grate the garlic, chop the mushrooms and shred the jackfruit.

RESERVE
150 g mushrooms for the topping.
```

### Hypothesis B — action-first with quantities inline

```text
2 — Prepare the filling

Grate the garlic. Finely chop 100 g of the 250 g mushrooms
and shred 400 g jackfruit.

Keep the remaining 150 g mushrooms for the topping.
```

Research supports contextual colocation of ingredients/quantities with actions. It does not determine which of these exact hierarchies is best on a phone. That remains an eval.

---

## 4. Split ingredients and reserved amounts

Split/reserved quantities are high-salience execution information because using the entire amount too early can make later steps impossible.

UX rule:

> When the source explicitly divides an ingredient or prepared component across steps, make the current allocation and future reservation difficult to miss.

Examples:

```text
USE NOW
100 g of 250 g mushrooms

KEEP FOR LATER
150 g mushrooms
```

or inline:

```text
Add 100 g of the mushrooms; keep the remaining 150 g for the topping.
```

If the source says only “use some and reserve the rest”, preserve that qualitative wording. Never invent an exact split.

Prepared intermediates are treated similarly:

```text
Use 2 tbsp of the dressing now.
Keep the rest for serving.
```

---

## 5. Sequence safety and look-ahead

V1 should be more conservative than previous drafts.

### 5.1 Preserve canonical action order

Default invariant:

> Do not reorder source/canonical actions in V1.

Instead, prevent surprises by **promoting prerequisite information earlier** in the presentation.

Example source sequence:

```text
1. Chop vegetables.
2. Mix sauce.
3. Bake at 200 °C.
```

If the recipe explicitly requires a preheated oven, the Cooking UX may **duplicate/promote that already-canonical prerequisite as look-ahead** before Step 1:

```text
BEFORE YOU START
Preheat oven to 200 °C.
```

The canonical prerequisite/action remains attached to its original source/canonical position as well; promotion is presentation-only and does not remove or reorder the canonical action sequence.

### 5.2 Parallel work

Safe V1 cues:
- source-explicit concurrency such as “meanwhile” / “while X bakes”;
- highly conservative use of otherwise idle passive waits when there is no ordering conflict.

Do not implement generalized LLM schedule optimization in V1.

Actual action reordering/optimization is a future capability that requires a dedicated eval before it is allowed.

---

## 6. Glanceability and navigation

The target is not “one step must fit on one iPhone screen.”

The better invariant is:

> Current position remains obvious, the information required for the current action is locally available, nearby future structure remains discoverable, and the UI does not force strictly sequential navigation.

Mobile design targets:
- avoid internal searching within one cooking unit;
- avoid excessive duplication that pushes the action below the fold;
- avoid exploding a normal recipe into 15–20 micro-steps;
- preserve a visible sense of phases/sub-goals;
- continuous navigation/scroll is the reference UX, but not a product invariant;
- optional Focus Mode may be explored later, but must not remove access to overview/look-ahead.

`NEXT` should normally be derived deterministically from the next unit/phase, not authored by an LLM merely to create prose.

---

## 7. Structural overview

Before or at the start of cooking, give a compact map of the process when the recipe supports it.

Example:

```text
FLOW
Prepare → Sauce → Bake → Finish
```

This overview should help users anticipate major phases without requiring them to read every instruction paragraph in advance.

It is not a replacement for source-grounded prerequisites. Long waits, rests or unusual equipment should be surfaced before the user commits to cooking.

---

## 8. Scaling

Scaling is deterministic and only enabled when the Canonical Recipe's versioned scaling policy has a determinate behavior for every affected quantity.

Rules:
- do not ask an LLM to scale quantities at runtime;
- `proportional` quantities are multiplied by the recipe-scale factor;
- `non_scalable` quantities deliberately remain constant;
- any affected `unknown` quantity disables automatic whole-recipe scaling rather than being silently held constant;
- do not scale qualitative quantities such as “to taste” into fake numbers;
- the displayed original source wording remains accessible when useful.

---

## 9. Images

V1 Cook Mode is text-first.

Hero imagery is useful primarily for discovery/library selection.

Out of scope for V1:
- generated step images;
- a maintained ingredient icon library;
- mandatory photography for cooking units.

These can be evaluated later if they solve a demonstrated problem rather than merely making the UI more decorative.

---

## 10. Cooking Plan generation lifecycle

The Cooking Plan is derived and replaceable.

Its generation policy remains intentionally open:
- eager;
- background;
- lazy on first recipe open.

Product invariant:

> Save/import/Bring should not wait for a high-quality Cooking Plan.

If the plan is not yet available, the recipe must still be viewable from Canonical Recipe data.

---

## 11. Evaluation priorities

Before freezing exact mobile hierarchy, evaluate at least:

1. **Contextual quantities:** separate `NOW YOU NEED` line vs quantities integrated into action prose.
2. **Glanceability:** whether users can identify current action, amount and critical parameter without searching.
3. **Reservation salience:** whether split ingredients/components are correctly held back.
4. **Preparation policy:** whether `assumedAtHand` reduces clutter without hiding readiness tasks.
5. **Overview:** whether phases/look-ahead reduce “I should have done that earlier” moments.
6. **Parallel cues:** whether conservative cues help rather than create scheduling errors.
7. **Recipe complexity:** whether meaningful units avoid both huge paragraphs and excessive micro-steps.

Success is not “the page looks clean”; success is lower execution friction and fewer avoidable recipe-following mistakes.

---

## 12. Non-goals for V1

Canonical preservation is not the same as active UX scope. For example, V1 may preserve source-provided nutrition/diet/cuisine/difficulty facts without implementing nutrition-driven selection, health coaching or recommendation behavior.

- automatic culinary improvement of the recipe;
- generalized scheduling/parallel optimization;
- changing source action order;
- nutrition/health coaching;
- voice assistant;
- mandatory focus/wizard mode;
- step imagery generation;
- universal pantry tracking;
- exact visual design frozen before real-device evaluation.
