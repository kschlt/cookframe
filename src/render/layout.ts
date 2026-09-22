/**
 * The page shell: one document, one stylesheet, no script (CFV1-SL2).
 *
 * `ADR-0007` commits rendering to `hono/html` tagged templates and names the
 * erosion risk explicitly — `hono/jsx` ships in the same package, so a component
 * system is one import away, and taking it would settle `OQ-12` in passing and
 * bias the cooking UX spike. This module imports `html` and `raw` and nothing
 * else from `hono`; `tests/slice2/no-jsx-or-component-system-imported` fails if
 * that changes anywhere under `src/`.
 *
 * The CSS is inline for the same reason the markup is plain: a served stylesheet
 * is an asset route, and asset routes are not this slice's subject. It is also
 * why there is no `<script>` — nothing here needs one, and an empty hydration
 * root would be a component system arriving by the back door.
 */
import { html, raw } from "hono/html"
import type { HtmlEscapedString } from "hono/utils/html"

/**
 * Plain CSS, mobile-first. No custom properties beyond colour tokens, no grid
 * framework, no component classes — S4 is meant to measure the design, and a
 * layout system here would be an answer to `OQ-12` that nobody decided.
 */
const STYLES = `
:root {
  --ink: #1b1b1a;
  --ink-soft: #55534e;
  --rule: #ddd9d2;
  --paper: #fbfaf8;
  --accent: #7a5c2e;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 1rem;
  background: var(--paper);
  color: var(--ink);
  font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
main { max-width: 42rem; margin: 0 auto; }
h1 { font-size: 1.6rem; line-height: 1.25; margin: 0 0 .4rem; }
h2 { font-size: 1.1rem; margin: 1.8rem 0 .6rem; border-bottom: 1px solid var(--rule); padding-bottom: .3rem; }
h3 { font-size: .95rem; margin: 1.2rem 0 .4rem; color: var(--ink-soft); }
a { color: var(--accent); }
img { max-width: 100%; height: auto; display: block; border-radius: 6px; }
ul, ol { padding-left: 1.2rem; }
li { margin: .3rem 0; }
.meta { color: var(--ink-soft); font-size: .88rem; margin: 0 0 .8rem; }
.signals { list-style: none; padding: 0; margin: .4rem 0; display: flex; flex-wrap: wrap; gap: .4rem .7rem; font-size: .82rem; color: var(--ink-soft); }
.signals li { margin: 0; }
.tag { border: 1px solid var(--rule); border-radius: 999px; padding: .1rem .5rem; }
.amount { font-variant-numeric: tabular-nums; }
.optional { color: var(--ink-soft); font-size: .85rem; }
.source-gap { color: var(--ink-soft); font-style: italic; font-weight: 400; }
.annotations { list-style: none; padding: 0; margin: .3rem 0 0; font-size: .85rem; color: var(--ink-soft); }
.annotations li { margin: .15rem 0; }
.cards { list-style: none; padding: 0; margin: 0; display: grid; gap: 1rem; }
.card { border: 1px solid var(--rule); border-radius: 8px; padding: .9rem; background: #fff; }
.card h2 { border: 0; margin: 0 0 .3rem; padding: 0; font-size: 1.05rem; }
.empty { color: var(--ink-soft); }
@media (min-width: 40rem) { .cards { grid-template-columns: 1fr 1fr; } }

/* The cooking view (CFV1-SL6). The treatment follows S4's prototype rather than
   being chosen here: the amounts a unit needs sit in a tinted block above the
   action sentence (layout A), and a split or a reserved amount is set apart from
   an ordinary quantity, which is the structural half of "unmissable". */
.units { list-style: none; padding: 0; counter-reset: unit; }
.unit { border-top: 1px solid var(--rule); padding: .9rem 0; counter-increment: unit; }
.unit:first-child { border-top: 0; }
.unit .action { margin: .5rem 0 0; }
.unit .action::before { content: counter(unit) ". "; font-weight: 700; color: var(--accent); }
.block-label { font-size: .75rem; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); font-weight: 700; margin: 0 0 .25rem; }
.now-you-need { background: #f3ede2; border-radius: 8px; padding: .5rem .6rem .5rem 1.6rem; margin: 0; list-style: disc; }
.now-you-need .split, .now-you-need .reserved { font-weight: 700; }
.now-you-need .mark { font-size: .72rem; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); margin-right: .25rem; }
.produces { font-size: .85rem; color: var(--ink-soft); margin: .4rem 0 0; }
.start-now .for-step, .set-up, .fetch-prepare { color: inherit; }
.start-now .for-step { color: var(--ink-soft); font-size: .85rem; }
`.trim()

/**
 * Renders a fragment to a string, failing loudly if it turned out to be async.
 *
 * `hono/html` returns `HtmlEscapedString | Promise<HtmlEscapedString>`: the
 * promise arm appears the moment an interpolated value is itself a promise.
 * Nothing here is async and nothing here should become async — rendering is a
 * pure function of a Canonical Recipe, which is what makes it deterministic.
 * But calling `.toString()` on the union is a trap: on the promise arm it
 * yields the literal `[object Promise]`, so the page would ship with its whole
 * body replaced by two words and no error raised anywhere. Failing closed turns
 * that silent corruption into a thrown one.
 */
function renderSync(fragment: HtmlEscapedString | Promise<HtmlEscapedString>): string {
  if (fragment instanceof Promise) {
    throw new Error(
      "render produced a promise: rendering is synchronous by construction (CFV1-SL2), so an " +
        "async fragment means a value reached the template that does not belong on a render path",
    )
  }
  return fragment.toString()
}

/**
 * Wraps a rendered body in the document shell. `title` is interpolated through
 * the tagged template, so it is escaped; `STYLES` is `raw` because it is this
 * module's own literal and never carries recipe data.
 */
export function page(title: string, body: HtmlEscapedString | Promise<HtmlEscapedString>): string {
  return renderSync(html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${raw(STYLES)}</style>
</head>
<body>
<main>${body}</main>
</body>
</html>
`)
}
