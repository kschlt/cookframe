/**
 * CFV1-SL4 — deterministic HTML → text extraction for the URL fallback path.
 *
 * When a page carries no sufficient Recipe JSON-LD, the deterministic adapter
 * declines it and the fallback asks a model to read the page instead. ADR-0019
 * §4a makes an architectural requirement of what the model is handed: the
 * **extracted text**, never the raw HTML. On the `url` path every captured block
 * must be *contained in the decoded input* (the CFV1-INJ anchor), and a block's
 * words are not contiguous in markup once tags and entities sit between them —
 * `200&nbsp;g` is not `200 g`, and `fl<b>our</b>` is not `flour`. Verifying prose
 * against tags would refuse every legitimate page. Extracting text before the
 * model sees it is what makes that anchor model-independent, so this module owns
 * it and the fallback composes it.
 *
 * It is deliberately dependency-free and regex-based, in the same style as the
 * JSON-LD script scan in {@link ./url-jsonld-adapter}: no DOM, no parser, no
 * network. It is not a general-purpose HTML renderer and does not try to be —
 * it drops non-content regions (script, style, head, comments), turns block-level
 * boundaries into line breaks so reading order and word boundaries survive,
 * strips the remaining tags, decodes the entities a recipe page actually uses,
 * and collapses runs of whitespace. What it guarantees is the property the anchor
 * needs: a run of prose that reads as one phrase on the page comes out as one
 * contiguous run of text.
 */

/**
 * Regions whose *contents* are not page text and must be removed wholesale, not
 * just untagged: script and style hold code, `<head>` holds metadata, and an
 * HTML comment holds nothing rendered. Removed before anything else so their
 * insides never leak into the output. Case-insensitive; `[\s\S]` so the body may
 * span lines.
 */
const NON_CONTENT = [
  /<script[\s\S]*?<\/script\s*>/gi,
  /<style[\s\S]*?<\/style\s*>/gi,
  /<head[\s\S]*?<\/head\s*>/gi,
  /<!--[\s\S]*?-->/g,
] as const

/**
 * Tags that introduce a visual/reading break. A closing or opening tag from this
 * set becomes a newline so that two separate lines of the page (two ingredients,
 * a heading and the paragraph under it) do not fuse into a phrase that appears on
 * neither — which would let capture "quote" a span that is not really on the page.
 * `br` and `hr` are void, so both spellings are matched. The list is
 * deliberately the block-level and list/table/heading set; inline tags (`b`,
 * `span`, `a`, `em`, …) are NOT here, because a word split by an inline tag must
 * REJOIN, not break.
 */
const BLOCK_BOUNDARY =
  /<\/?(?:p|div|section|article|header|footer|main|aside|nav|ul|ol|li|dl|dt|dd|table|thead|tbody|tfoot|tr|th|td|h[1-6]|blockquote|pre|figure|figcaption|form|fieldset|address|hr|br)\b[^>]*>/gi

/** Any remaining tag: stripped without inserting a break, so inline markup rejoins. */
const ANY_TAG = /<[^>]+>/g

/**
 * The named entities a recipe page actually reaches for: the five that are
 * mandatory to decode (they encode characters that are structural in HTML), the
 * spaces, and the accented letters and punctuation common in the German and
 * French recipe corpus this path serves. This is NOT a general HTML entity table
 * — an unknown named entity is left as written rather than guessed, which is safe
 * because capture transcribes spans of THIS output, so the model and the anchor
 * see the same bytes either way. Numeric entities (below) cover the long tail.
 */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  // Spaces of various widths fold to an ordinary space.
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  // Punctuation.
  hellip: "…",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  deg: "°",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  // German.
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  // French.
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  agrave: "à",
  acirc: "â",
  ccedil: "ç",
  ugrave: "ù",
  icirc: "î",
  iuml: "ï",
  ocirc: "ô",
}

/** A numeric (`&#233;`) or hexadecimal (`&#xE9;`) character reference. */
const NUMERIC_ENTITY = /&#(x[0-9a-fA-F]+|[0-9]+);/g

/** A named character reference (`&nbsp;`). */
const NAMED_ENTITY = /&([a-zA-Z][a-zA-Z0-9]*);/g

/**
 * Decode the HTML entities in `text`: numeric and hexadecimal references by their
 * code point, and the named references this path knows. An unknown named
 * reference is returned verbatim (`&notareal;` stays `&notareal;`), and a numeric
 * reference outside the Unicode range is likewise left as written rather than
 * throwing — extraction never fails on a malformed byte.
 */
function decodeEntities(text: string): string {
  return text
    .replace(NUMERIC_ENTITY, (whole, body: string) => {
      const code =
        body[0] === "x" || body[0] === "X"
          ? Number.parseInt(body.slice(1), 16)
          : Number.parseInt(body, 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole
      try {
        return String.fromCodePoint(code)
      } catch {
        return whole
      }
    })
    .replace(NAMED_ENTITY, (whole, name: string) => NAMED_ENTITIES[name] ?? whole)
}

/**
 * Extract the readable text of an HTML page as a deterministic string, suitable
 * to hand a model on the URL fallback path (ADR-0019 §4a).
 *
 * The order is load-bearing: non-content regions go first (so their insides never
 * survive), then block boundaries become newlines (before the tags they live on
 * are stripped), then inline tags are removed WITHOUT a break (so a word split by
 * `<b>` rejoins), then entities are decoded, and finally whitespace is collapsed —
 * runs of spaces to one space, every blank line dropped — and the result trimmed.
 * Adjacent boundary tags (`</li><li>`) each emit a newline, so one blank line per
 * boundary is an artifact, not structure: each content line stands on its own and
 * nothing needs paragraph spacing. Entities are decoded AFTER tags are stripped so
 * a decoded `&lt;` can never reintroduce something that reads as a tag.
 */
export function htmlToText(html: string): string {
  let s = html
  for (const region of NON_CONTENT) s = s.replace(region, " ")
  s = s.replace(BLOCK_BOUNDARY, "\n")
  s = s.replace(ANY_TAG, "")
  s = decodeEntities(s)
  // Collapse spaces and tabs within a line, trim each line, and drop the empty
  // lines that adjacent boundary tags leave behind, so the output is one content
  // line per readable line regardless of the source's indentation or tag nesting.
  s = s.replace(/[^\S\n]+/g, " ")
  const lines = s
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
  return lines.join("\n")
}
