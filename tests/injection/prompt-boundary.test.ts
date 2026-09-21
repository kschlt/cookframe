/**
 * CFV1-INJ — the structural half: untrusted text reaches a prompt through one
 * place, and a second path fails the build rather than being noticed in review.
 *
 * This is modelled on the ADR-0010 chokepoint test, for the same reason. The
 * guarantee in `untrusted-source-text.ts` — a fence the page cannot close,
 * instructions in a channel no source byte reaches — protects nothing if another
 * module can interpolate the page's words into a prompt string of its own. A
 * rule that lives only in a docstring is a rule someone has to remember; this
 * turns forgetting it into a failing test with a message.
 *
 * Two assertions, in the inventory style the chokepoint settled on:
 *
 *   1. The modules that ASSEMBLE PROMPTS are a declared inventory. Decoding
 *      bytes is not itself the hazard — the deterministic JSON-LD adapter, the
 *      fake provider and the egress module all decode bytes and build no prompt
 *      — so the scan has to know which modules put text in front of a model,
 *      and a new one has to be added here on purpose.
 *   2. Inside those modules, the untrusted VALUES — decoded input bytes, the
 *      snapshot handed to normalization, and a rejected model reply — appear
 *      only inside a `sealSourceText(...)` call. Anywhere else they are on
 *      their way into a prompt unfenced.
 *
 * What this does NOT claim: that the model obeys the fence. Nothing static can
 * establish that, and the item's second half (`claim-support.ts`) exists because
 * it cannot be assumed.
 */
import { readFileSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { sourceFiles } from "../url-fetch/network-primitives.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const srcDir = join(repoRoot, "src")

/**
 * Expressions that produce text written by someone other than the pipeline.
 *
 * `decode(` is a fetched page or a paste becoming a string; `JSON.stringify(
 * snapshot` is the captured page handed back for normalization, blocks and all;
 * `failure.reply` is a model reply the contract rejected — untrusted because a
 * page that steered the model steers what it emits, and that path is the one
 * where the model has already departed from its contract.
 *
 * `snapshot` appears as a bare needle on purpose, so that reaching into it for
 * content — `snapshot.blocks[0].text` and anything like it — is caught without
 * anyone having had to anticipate that spelling. The few uses that are the
 * pipeline's own are named in {@link PIPELINE_AUTHORED} instead.
 */
const UNTRUSTED_EXPRESSIONS: readonly (readonly [string, string])[] = [
  ["new TextDecoder().decode(", "fetched or pasted source bytes becoming prompt text"],
  ["sourceText", "the binding the decoded bytes are held in"],
  ["JSON.stringify(snapshot", "the captured page, blocks and all, handed to normalization"],
  ["snapshot", "the captured page under any binding"],
  ["failure.reply", "a rejected model reply, quoted back on the repair path"],
]

/**
 * The exact interpolated expressions that are the PIPELINE's own words, listed
 * one by one because each is a hole in the rule above.
 *
 * Matching is on the whole expression, not a prefix, so this cannot be widened
 * by accident: `${snapshot.id}` is permitted and
 * `${snapshot.id + snapshot.blocks[0].text}` is not, because the second is not
 * this string. Anything reached through an untrusted value and not written here
 * is an offence — a content field added to `SourceSnapshot` later is flagged on
 * its first use rather than inheriting an allowance nobody revisited.
 */
const PIPELINE_AUTHORED: readonly (readonly [string, string])[] = [
  [
    "snapshot.id",
    "the pipeline's identifier for the capture, assigned before the model saw anything",
  ],
  ["failure.message", "the validator's own sentence about why a reply was rejected"],
]

/**
 * Every module that builds a {@link ModelPart}, with what it is for.
 *
 * Identified structurally by constructing `kind: "text"`, so the inventory
 * cannot drift from the code: a module that starts assembling prompts fails
 * this test until it is declared, and a declared one that stops fails it too.
 * `providers.ts` declares the type rather than building one, and the sealer is
 * the boundary itself.
 */
const PROMPT_ASSEMBLERS = new Map([
  [
    "pipeline/model-providers.ts",
    "the two ADR-0004 capabilities — the only place a prompt is assembled from source material",
  ],
  [
    "pipeline/untrusted-source-text.ts",
    "CFV1-INJ: the sealer, which is the boundary rather than a crossing of it",
  ],
])

/** Character spans of every `sealSourceText(...)` call in `text`. */
function sealCallSpans(text: string): readonly (readonly [number, number])[] {
  const spans: [number, number][] = []
  const needle = "sealSourceText("
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    let depth = 0
    for (let i = at + needle.length - 1; i < text.length; i++) {
      if (text[i] === "(") depth++
      else if (text[i] === ")") {
        depth--
        if (depth === 0) {
          spans.push([at, i])
          break
        }
      }
    }
  }
  return spans
}

const relativeToSrc = (file: string): string => relative(srcDir, file).split(sep).join("/")

describe("injection/source-text-crosses-one-boundary", () => {
  it("the set of prompt-assembling modules is the declared inventory", () => {
    const assemblers = sourceFiles(srcDir)
      .filter((f) => readFileSync(f, "utf8").includes('kind: "text"'))
      .map(relativeToSrc)
      .filter((rel) => rel !== "pipeline/providers.ts") // declares the type, builds none
      .sort()
    expect(
      assemblers,
      "a module that assembles model prompts is not declared in PROMPT_ASSEMBLERS",
    ).toEqual([...PROMPT_ASSEMBLERS.keys()].sort())
  })

  it("no untrusted value is interpolated into a prompt string", () => {
    // Checked at the point of INTERPOLATION rather than at the declaration
    // site. Binding decoded bytes to a named const is legitimate and clearer —
    // the hazard is the value reaching a prompt string, not existing. Every
    // `${...}` in a prompt-assembling module is inspected; the untrusted
    // expressions and the bindings that hold them may not appear in one.
    //
    // A few expressions reach into an untrusted object for something the
    // pipeline itself wrote — the capture's assigned id, the validator's own
    // sentence about why a reply was rejected. Those are listed exactly in
    // PIPELINE_AUTHORED; the rejected reply that sentence describes travels
    // sealed, beside it.
    const offences: string[] = []
    for (const file of sourceFiles(srcDir)) {
      const rel = relativeToSrc(file)
      if (!PROMPT_ASSEMBLERS.has(rel) || rel === "pipeline/untrusted-source-text.ts") continue
      const text = readFileSync(file, "utf8")
      for (const match of text.matchAll(/\$\{([^}]*)\}/g)) {
        const expression = (match[1] ?? "").trim()
        if (PIPELINE_AUTHORED.some(([permitted]) => permitted === expression)) continue
        for (const [needle, why] of UNTRUSTED_EXPRESSIONS) {
          if (expression.includes(needle)) {
            offences.push(`${rel}: \`\${${expression}}\` interpolates ${needle} (${why})`)
          }
        }
      }
    }
    expect(
      offences,
      `untrusted source text must reach a prompt only through sealSourceText:\n${offences.join("\n")}`,
    ).toEqual([])
  })

  it("the decoded source is handed to the sealer, not used raw", () => {
    // The companion to the check above: interpolation is forbidden, and the
    // value must actually reach the boundary. Together these say the decoded
    // bytes go through the sealer and nowhere else that builds a prompt.
    const text = readFileSync(join(srcDir, "pipeline", "model-providers.ts"), "utf8")
    expect(text).toMatch(/sealSourceText\(\s*"raw source text",\s*sourceText/)
    expect(text).toMatch(/const sourceText = .*TextDecoder\(\)\.decode\(input\)/)
  })

  it("every prompt assembler that handles source material imports the sealer", () => {
    const importers = sourceFiles(srcDir)
      .filter((f) => readFileSync(f, "utf8").includes("untrusted-source-text.js"))
      .map(relativeToSrc)
      .sort()
    // Exactly the assemblers, minus the sealer itself, which is what they import.
    expect(importers, "a prompt assembler no longer routes source text through the sealer").toEqual(
      [...PROMPT_ASSEMBLERS.keys()].filter((k) => k !== "pipeline/untrusted-source-text.ts").sort(),
    )
  })

  it("the system channel is built from the pipeline's own strings only", () => {
    // `buildExchange` is where instructions and data would be concatenated if
    // they ever were. Its `system` array must contain no untrusted expression —
    // the check above proves that globally, this one pins the specific function
    // so a future edit to it is read against its own rule.
    const text = readFileSync(join(srcDir, "pipeline", "model-providers.ts"), "utf8")
    const start = text.indexOf("function buildExchange(")
    expect(start).toBeGreaterThan(-1)
    const body = text.slice(start, text.indexOf("\n}", start))
    for (const [expression] of UNTRUSTED_EXPRESSIONS) {
      expect(body, `buildExchange interpolates ${expression} into the prompt`).not.toContain(
        expression,
      )
    }
    // It receives the sealed part already built, and states the rule naming it.
    expect(body).toContain("untrustedRegionRule(")
  })
})
