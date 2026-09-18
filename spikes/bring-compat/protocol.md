# Bring observation protocol — on-device half of CFV1-S3

Half of what S3 must answer lives in the Bring **app**, not in its HTTP traffic: how an
imported recipe looks once it lands, what return navigation the user gets, and what a
Bring-side *share* actually propagates. The API half is recorded automatically in
`fixtures/` by `record.py`. This protocol is the manual half — run it on a phone with Bring
installed, one section per question, and paste what you see under each **Observation** line.

The recipe source for every case is a disposable page under
`spikes/bring-compat/pages/`, served from `raw.githubusercontent.com`. Import each by pasting
its raw URL into Bring's "import recipe from URL". Pin the pages at a fixed commit so the
observation is reproducible; the current commit is recorded in each fixture's
`pages_pinned_at`.

For each case: import the URL, then record what the app shows. Where the app disagrees with
the parser JSON in `fixtures/`, the disagreement is the finding — note it explicitly.

---

## Q1 — Missing author (required vs tolerated, in the app)

Pages: `missing-author.html`, `empty-author.html`, control `baseline.html`.

- Does the import succeed with no author at all?
- Does the app show a blank author, a placeholder, or invent one? (It must never fabricate one.)

**Observation (author absent):**
**Observation (author empty string):**
**Observation (control, author present):**

## Q2 — Ingredient parsing (in the app)

Pages: `ingredient-parsing.html`, control `baseline.html`.

- Which lines became clean list items, and which stayed as free text?
- Note any line where the app's split of quantity / unit / name differs from the parser JSON.

**Observation:**

## Q3 — Quantity classes: exact / vague / ranged (in the app)

Pages: `quantity-exact.html`, `quantity-vague.html`, `quantity-ranged.html`.

- Do vague amounts ("etwas", "eine Prise") appear as an unquantified item, or get dropped?
- Do ranges ("2-3 EL", "400–500 g") keep the range, collapse to one bound, or fail?
- When you change the serving count in the app, what happens to a vague item and to a ranged item?

**Observation (exact):**
**Observation (vague):**
**Observation (ranged):**

## Q4 — Multiple contextual yields, and scaling base (in the app)

Pages: `multi-yield.html`, `no-yield.html`, `yield-bare-number.html`, control `baseline.html`.

- With several yields declared, which one does the app adopt as the base?
- Change the serving count up and down. Do quantities scale from the base yield or from the
  count you request? (The API half already shows the parser scales linearly from `baseQuantity`;
  confirm the app matches, and note the base it starts from for the multi-yield page.)

**Observation (multiple yields — base adopted):**
**Observation (no yield — does scaling work at all):**
**Observation (bare number yield):**
**Observation (scale up / down behaviour):**

## Q5 — No-image recipe (in the app)

Pages: `no-image.html`, `broken-image.html`, control `baseline.html`.

- Does a recipe with no image import cleanly? What placeholder, if any, does the app show?
- Does a recipe whose image URL 404s behave differently from one with no image field?

**Observation (no image field):**
**Observation (image URL 404s):**

## Q6 — Tokenized URL and return navigation (in the app)

Page: `t/9f2c7ae4b1d04c6f8e3a5b7c9d1e2f30/recipe.html` (an unguessable path — the shape of a
capability URL).

- Does import from an unguessable-path URL work the same as from a plain one? (API half: yes for
  a path token, **no** once the token is a query string — the parser drops the query and 404s.)
- After importing, what return navigation does the user get — a link back to the source page, a
  "linkOut" button, nothing? Where does it point?
- Is the full source URL, including its token, visible anywhere in the Bring UI after import?

**Observation (import works):**
**Observation (return navigation offered):**
**Observation (is the token URL exposed in the UI):**

## Q7 — Bring-side share: what it propagates (the privacy question)

Page: `baseline.html`, and the capability-URL page from Q6.

This is the one question with a privacy consequence rather than a convenience one. Design the
observation so a *negative* answer (the share does **not** carry the source URL) is as well
evidenced as a positive one.

- Import a recipe, then use Bring's own share feature (share the recipe, or share the list it
  went into) to a second account or a note app you control.
- Inspect exactly what arrives at the other end: a Bring deep link, the recipe contents, or the
  original source URL / capability URL?
- Specifically: can the recipient reach the original source page from what they received? Try
  opening every link in the shared payload.

**Observation (what the share payload contains):**
**Observation (can the recipient recover the source / capability URL — yes / no):**
**Observation (what the recipient can do with it):**
