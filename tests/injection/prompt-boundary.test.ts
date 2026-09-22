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
import type { SourceSnapshot } from "../../schema/index.js"
import {
  createModelCaptureProvider,
  createModelNormalizationProvider,
} from "../../src/pipeline/model-providers.js"
import type { ModelExchange, ModelTransport } from "../../src/pipeline/providers.js"
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
  [
    "failure.message",
    "a rejection REASON, which embeds the model's own words: the capture stage " +
      "builds it from the reply's `type` value verbatim and normalization from a " +
      "Zod error carrying the reply's unrecognized key names",
  ],
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
    // One expression reaches into an untrusted object for something the pipeline
    // itself wrote — the capture's assigned id — and is listed exactly in
    // PIPELINE_AUTHORED.
    //
    // `failure.message` was listed there too, as "the validator's own sentence".
    // It is not: `readBlocks` builds it from the model's own `type` value and
    // normalization from a Zod error carrying key names out of the reply, so a
    // reply could open its own headed section inside the pipeline's instruction
    // part. It is an UNTRUSTED expression, and the reason now travels sealed
    // beside the reply it describes. An allowlist entry is a judgement about a
    // value's provenance, and this one was wrong — which is why there is exactly
    // one left and it names a value assigned before the model saw anything.
    const offences: string[] = []
    for (const file of sourceFiles(srcDir)) {
      const rel = relativeToSrc(file)
      if (!PROMPT_ASSEMBLERS.has(rel) || rel === "pipeline/untrusted-source-text.ts") continue
      const text = readFileSync(file, "utf8")
      // An interpolation INSIDE a `sealSourceText(...)` call is the untrusted
      // value reaching the boundary, which is the one crossing that is allowed
      // to exist. Exempting it by span rather than by expression is what keeps
      // the rule from needing a second allowlist: the sealer's argument list is
      // identified structurally, so a value cannot be permitted by being named.
      const sealed = sealCallSpans(text)
      for (const match of text.matchAll(/\$\{([^}]*)\}/g)) {
        const at = match.index ?? 0
        if (sealed.some(([from, to]) => at > from && at < to)) continue
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

/**
 * The load-bearing half, added after round 5 of review found the scan above
 * blind to `+` — as round 2 found it blind to `.concat()`.
 *
 * Widening the pattern is not the fix, and the second finding is the proof: the
 * next construction escapes the next pattern, and each widening reads as
 * progress while the hole moves. The behavioural proofs written after round 2
 * held only per known value on its path of the day, so completeness depended on
 * someone remembering to add a proof for a fourth value.
 *
 * So this checks the RESULT instead of the route to it. Assemble the exchange
 * twice from inputs that differ only in what the source controls, cut out the
 * fenced regions, and require what remains to be byte-identical. Any byte of
 * the source that reaches the instruction channel makes the remainder differ —
 * through a template, `+`, `.concat`, `Array.join`, a helper three calls down,
 * or a construction nobody has thought of, because none of that is looked at.
 *
 * The marker is drawn from the test seam so both runs fence with the same one;
 * production draws it from `crypto.randomUUID()`.
 *
 * What it does NOT cover, stated plainly because the record should not claim
 * more than the guard holds: a field of `SourceSnapshot` that {@link voiced}
 * does not vary is not exercised, so a content field added to the contract
 * later needs a line there. That is one edit in one place with a failing
 * differential behind it, rather than a per-value proof per path — but it is
 * not nothing, and it is the reason the inventory scan above is kept.
 */
const FENCED = /<<<(UNTRUSTED-SOURCE-[^\s>]*) \([^)]*\)>>>\n[\s\S]*?\n<<<END \1>>>/g

/** Everything the exchange puts in front of the model, with fenced regions cut out. */
function outsideTheFence(exchange: ModelExchange): string {
  return [
    exchange.system,
    ...exchange.parts.map((part) =>
      part.kind === "text" ? part.text : `<image ${part.mediaType} ${part.bytes.length}B>`,
    ),
  ]
    .map((text) => text.replace(FENCED, "<<<FENCED REGION, CUT OUT BY THIS PROOF>>>"))
    .join("\n--- part boundary ---\n")
}

/**
 * A snapshot in one `voice`: every string the SOURCE controls carries it, and
 * every string the PIPELINE assigns is held constant.
 *
 * That split is the whole judgement in this proof, and it is made once, here,
 * where it can be read — not spread across an allowlist of expressions. `id`
 * and `captureProvenance` are the pipeline's own; a block's `type` is voiced
 * because the capture model CHOOSES it, which is how round 3's leak got in.
 * Block ids are voiced too although CFV1-S6's policy assigns them, not the
 * model: nothing needs an id outside the fence, so permitting one would have to
 * be argued for rather than inherited.
 */
function voiced(voice: string): SourceSnapshot {
  return {
    id: "snap-assigned-by-the-pipeline",
    version: 1,
    sourceType: "url",
    sourceUrl: `https://${voice}.invalid/${voice}-path`,
    sourceSite: `${voice} site name`,
    capturedText: `${voice} captured text`,
    blocks: [
      { id: `${voice}-b1`, order: 0, type: "title", text: `${voice} title text` },
      {
        id: `${voice}-b2`,
        order: 1,
        type: voice === "alpha" ? "ingredient_group" : "instruction_group",
        text: `${voice} group text`,
        heading: `${voice} group heading`,
      },
    ],
    captureProvenance: {
      sourceAdapter: "adapter-assigned-by-the-pipeline",
      adapterVersion: "0.0.0",
      runId: "capture-run-assigned-by-the-pipeline",
    },
  }
}

/** A transport that records every exchange and always replies `reply`. */
function recording(reply: string): ModelTransport & { readonly seen: ModelExchange[] } {
  const seen: ModelExchange[] = []
  return {
    seen,
    async send(exchange) {
      seen.push(exchange)
      return { text: reply }
    },
  }
}

const boundaryStage = (transport: ModelTransport) => ({
  transport,
  promptText: "PROMPT",
  contractText: "CONTRACT",
  markerSource: () => "FIXED",
})

/**
 * Drive one stage to exhaustion and return every exchange it built.
 *
 * The reply is always rejected on purpose: the stage retries once, so ONE run
 * yields both the initial exchange and the repair exchange. The repair path is
 * where the rejected reply and the rejection REASON enter, and the reason is
 * built from the reply's own words — so a voiced reply voices the reason too.
 */
async function exchangesFor(voice: string): Promise<{
  capture: readonly ModelExchange[]
  normalization: readonly ModelExchange[]
}> {
  const captureTransport = recording(
    JSON.stringify({
      capturedText: "x",
      blocks: [{ id: "b1", order: 0, type: `${voice}-not-a-block-type`, text: "t" }],
    }),
  )
  await createModelCaptureProvider(boundaryStage(captureTransport))
    .capture(new TextEncoder().encode(`${voice} fetched page text`), {
      snapshotId: "snap-assigned-by-the-pipeline",
      snapshotVersion: 1,
      sourceAdapter: "adapter-assigned-by-the-pipeline",
      adapterVersion: "0.0.0",
      runId: "capture-run-assigned-by-the-pipeline",
      captureModel: "m",
      sourceMediaType: "text/html",
    })
    .catch(() => undefined)

  const normTransport = recording(JSON.stringify({ [`${voice}UnknownKey`]: 1 }))
  await createModelNormalizationProvider(boundaryStage(normTransport))
    .normalize(voiced(voice), {
      runId: "r",
      targetOntologyVersion: "1.0.0",
      normalizationModel: "m",
    })
    .catch(() => undefined)

  return { capture: captureTransport.seen, normalization: normTransport.seen }
}

describe("injection/source-text-crosses-one-boundary", () => {
  it("nothing the source controls reaches the model outside the fence", async () => {
    const [alpha, beta] = await Promise.all([exchangesFor("alpha"), exchangesFor("beta")])

    // Both stages retry once, so each run yields the first call and the repair.
    expect(alpha.capture).toHaveLength(2)
    expect(alpha.normalization).toHaveLength(2)
    expect(beta.capture).toHaveLength(2)
    expect(beta.normalization).toHaveLength(2)

    const paths: readonly (readonly [
      string,
      readonly ModelExchange[],
      readonly ModelExchange[],
    ])[] = [
      ["capture, first call (the fetched bytes)", alpha.capture, beta.capture],
      ["normalization, first call (the snapshot)", alpha.normalization, beta.normalization],
    ]
    for (const [what, a, b] of paths) {
      expect(
        outsideTheFence(a[0] as ModelExchange),
        `${what}: the source's own words changed the prompt outside the fenced region`,
      ).toEqual(outsideTheFence(b[0] as ModelExchange))
      expect(
        outsideTheFence(a[1] as ModelExchange),
        `${what}, on the REPAIR call: the rejected reply or the rejection reason reached the instruction channel`,
      ).toEqual(outsideTheFence(b[1] as ModelExchange))
    }
  })

  it("the proof discriminates: the same words inside the fence do differ", async () => {
    // A differential proves nothing unless the inputs really did differ, and the
    // fenced region is where that difference is supposed to live. Without this,
    // a `voiced` that accidentally produced identical snapshots — or a strip
    // that cut the whole prompt away — would read as a pass.
    const [alpha, beta] = await Promise.all([exchangesFor("alpha"), exchangesFor("beta")])
    const fencedText = (exchange: ModelExchange): string =>
      exchange.parts
        .map((part) => (part.kind === "text" ? part.text : ""))
        .join("\n")
        .match(FENCED)
        ?.join("\n") ?? ""

    const pairs: readonly (readonly [ModelExchange, ModelExchange])[] = [
      [alpha.capture[0] as ModelExchange, beta.capture[0] as ModelExchange],
      [alpha.normalization[0] as ModelExchange, beta.normalization[0] as ModelExchange],
      [alpha.capture[1] as ModelExchange, beta.capture[1] as ModelExchange],
      [alpha.normalization[1] as ModelExchange, beta.normalization[1] as ModelExchange],
    ]
    for (const [a, b] of pairs) {
      expect(fencedText(a), "the two runs did not actually differ").not.toEqual(fencedText(b))
    }
  })
})
