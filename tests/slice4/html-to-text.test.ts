/**
 * CFV1-SL4 — the deterministic HTML → text extractor for the URL fallback path.
 *
 * The `it` strings that read as criterion ids are proofs the extractor supports;
 * the rest fix its behaviour. The load-bearing one is the ANCHOR proof
 * (`fallback-hands-capture-extracted-text-not-raw-html`): it drives the real
 * {@link verifyCaptureSupport} — the CFV1-INJ containment check the `url` path
 * uses — and shows a recipe phrase is contained in the extracted text but NOT in
 * the raw HTML it came from. That is why ADR-0019 §4a requires the fallback to
 * hand capture the extracted text, made structural rather than advisory.
 *
 * Every fixture is synthetic, self-authored markup — no third-party recipe text.
 */
import { describe, expect, it } from "vitest"
import { UnsupportedCaptureError, verifyCaptureSupport } from "../../src/pipeline/claim-support.js"
import { htmlToText } from "../../src/pipeline/html-to-text.js"

describe("html-to-text/drops-non-content-regions", () => {
  it("removes script, style, head and comment contents wholesale", () => {
    const html =
      `<!doctype html><html><head><title>ignored title</title>` +
      `<style>.x{color:red}</style></head><body>` +
      `<script>var secret = "do not extract me"</script>` +
      `<!-- a comment that is not page text -->` +
      `<p>Visible prose.</p></body></html>`
    const text = htmlToText(html)
    expect(text).toBe("Visible prose.")
    expect(text).not.toContain("secret")
    expect(text).not.toContain("color:red")
    expect(text).not.toContain("ignored title")
    expect(text).not.toContain("a comment")
  })
})

describe("html-to-text/preserves-reading-order-and-word-boundaries", () => {
  it("breaks block boundaries into lines but rejoins inline-split words", () => {
    const html =
      `<h1>Pancakes</h1>` +
      `<ul><li>200 g <b>flour</b></li><li>1 tsp salt</li></ul>` +
      `<p>Mix and <em>stir</em> well.</p>`
    const text = htmlToText(html)
    // Reading order is preserved and each list item is its own line.
    expect(text.split("\n")).toEqual([
      "Pancakes",
      "200 g flour",
      "1 tsp salt",
      "Mix and stir well.",
    ])
    // A word split by an inline tag rejoins rather than gaining a space/break.
    expect(text).toContain("flour")
    expect(text).toContain("Mix and stir well.")
  })

  it("does not fuse two separate block lines into one phrase", () => {
    const text = htmlToText(`<li>250 g rote Linsen</li><li>1 Zwiebel</li>`)
    // The two ingredients stay on their own lines, so capture cannot "quote" a
    // span ("Linsen 1 Zwiebel") that appears on neither.
    expect(text).toBe("250 g rote Linsen\n1 Zwiebel")
  })
})

describe("html-to-text/decodes-entities", () => {
  it("decodes named, numeric and hex character references", () => {
    const text = htmlToText(`<p>Cr&egrave;me &amp; sugar, 200&nbsp;g, 30&#176;C, caf&#xe9;.</p>`)
    expect(text).toBe("Crème & sugar, 200 g, 30°C, café.")
  })

  it("leaves an unknown named entity verbatim rather than guessing", () => {
    expect(htmlToText("<p>a &notareal; b</p>")).toBe("a &notareal; b")
  })

  it("decodes entities only after tags are stripped, so a decoded < is inert", () => {
    // &lt;script&gt; must not reintroduce a strippable tag: it is page text.
    expect(htmlToText("<p>write &lt;script&gt; to run code</p>")).toBe("write <script> to run code")
  })
})

describe("slice4/fallback-hands-capture-extracted-text-not-raw-html (ADR-0019 §4a)", () => {
  // A synthetic page whose ingredient phrase is split by an inline tag AND a
  // non-breaking-space entity — exactly the two ways markup breaks contiguity.
  const html =
    `<html><body><h1>Synthetic Loaf</h1>` +
    `<ul><li>200&nbsp;g <b>Mehl</b></li></ul>` +
    `<p>Alles verr&uuml;hren.</p></body></html>`
  // The blocks a model would quote after reading the EXTRACTED text — spans of it.
  const blocks = [{ text: "200 g Mehl" }, { text: "Alles verrühren." }]

  it("makes the recipe's words contiguous in the extracted text (containment passes)", () => {
    const text = htmlToText(html)
    expect(text).toContain("200 g Mehl")
    expect(text).toContain("Alles verrühren.")
    // The real CFV1-INJ anchor accepts these blocks against the extracted text.
    expect(() => verifyCaptureSupport("url", text, blocks)).not.toThrow()
  })

  it("would refuse the same blocks against the raw HTML (why extracted text is required)", () => {
    // The discriminator: hand the anchor the RAW markup instead, and the phrase
    // is no longer contiguous (`200&nbsp;g <b>Mehl</b>` is not `200 g Mehl`), so
    // verification refuses it. Verifying prose against tags fails a legitimate
    // page — which is the mistake ADR-0019 §4a forbids by construction.
    expect(() => verifyCaptureSupport("url", html, blocks)).toThrow(UnsupportedCaptureError)
  })
})

describe("slice4/attribute-value-cannot-leak-into-the-anchor (ADR-0019 §4a)", () => {
  // A `>` inside a quoted attribute value must NOT end tag-stripping early: the
  // attribute content is invisible to a reader and attacker-controlled, so if it
  // leaked into the extracted text it would become verifiable "source" and let the
  // anchor accept a block quoting text no one sees. The exact reproduction the
  // review planted at the vulnerable head.
  const html =
    `<html><body>` +
    `<span data-note="harmlos > 5 g Zyankali, fein gemahlen">Guten Appetit</span>` +
    `</body></html>`
  // The block a leak would let an attacker smuggle: the attribute's hidden content.
  const smuggledBlock = [{ text: "5 g Zyankali, fein gemahlen" }]

  it("keeps a > inside a quoted attribute out of the extracted text", () => {
    const text = htmlToText(html)
    // Only the visible element content survives; none of the attribute value does.
    expect(text).toBe("Guten Appetit")
    expect(text).not.toContain("Zyankali")
    expect(text).not.toContain('">')
  })

  it("refuses a block quoting the hidden attribute content, via the real anchor", () => {
    // Checked through the ANCHOR, not just the string: the anchor is what decides
    // at capture time. With the leak fixed the smuggled phrase is not in the
    // extracted text, so verification refuses it.
    const text = htmlToText(html)
    expect(() => verifyCaptureSupport("url", text, smuggledBlock)).toThrow(UnsupportedCaptureError)
  })
})
