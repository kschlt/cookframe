# How often does a real recipe page carry more than one Recipe node?

`CFV1-MR1` makes a page carrying several distinct `Recipe` nodes **refuse** where it previously
imported the richest one silently. That trades a silent loss for a visible refusal, which is the
right direction — but only if the refusal does not fire on ordinary pages. This is the measurement
of that cost, registered before the behaviour is relied on rather than after someone complains.

## Method

The S2 corpus's own fetched URLs (`spikes/url-extraction/results.json`, 15 of 18 reachable), re-fetched
fresh on **2026-09-22** and run through the **shipped** `extractRecipeJsonLd` — not a re-implementation.
That distinction is not pedantry: the CFV1-INJ threshold was calibrated with a Python probe and the
shipped TypeScript then disagreed with it, because `\w` is ASCII-only in JavaScript. A probe measures
the probe. `spikes/mr1-node-count/count.mts` is the script.

No page content is recorded here or anywhere in the repository — only counts.

## Result

| outcome | of 15 |
|---|---|
| one distinct recipe, imports as before | **15** |
| several distinct recipes, refused | **0** |

**The refusal did not fire once.** On the pages Slice 4's URL import is built for, `CFV1-MR1` costs
nothing: no page in the corpus carries a second distinct `Recipe` node, so none of them changes
behaviour.

Two observations worth keeping beside that number:

- All 15 now read as `sufficient`, where S2 measured 14 of 15. One site's markup improved between
  the two runs, so these figures and S2's are **not** the same measurement of the same pages.
- Duplicate emission is real and is why counting is per *distinct* recipe rather than per node. A
  page emitting one recipe inside `@graph` and again standalone is one recipe; counting nodes would
  have refused ordinary pages, and the proof
  `multi-recipe/counts one recipe once, however many times the page emits it` is what holds that.

## What this does NOT establish

**The corpus cannot exhibit the phenomenon.** S2 chose single-recipe article pages on purpose, so a
zero here is close to guaranteed by the selection and is weak evidence about pages in general. A
zero from a corpus that cannot show the thing reads exactly like a zero from one that can.

The pages that carry several `Recipe` nodes are **roundups and category pages** — "10 soups for
autumn", a tag index, a collection — and none is in this corpus. Those are where the refusal will
actually fire, and its rate there is **unmeasured**. That matters for the product rather than for
this unit: whether a user pasting a roundup URL should get a refusal, a chooser, or all ten recipes
is `CFV1-MR2`'s question and a product decision, not this one's. What `CFV1-MR1` owes is that the
loss is never silent, and that holds regardless of the rate.

Nothing here says the count from a MODEL is accurate. This measures the deterministic JSON-LD path
only, where counting is reading. The capture path's count is a model's claim, which is why it is
treated as evidence that drives a refusal and is never recorded as a fact about the source.
