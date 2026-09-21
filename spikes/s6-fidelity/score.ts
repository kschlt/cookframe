/**
 * CFV1-S6 fidelity scorer (spike, OQ-24).
 *
 * Not product code — lives under spikes/ (excluded from build, lint, and the
 * committed eval harness). Run with tsx:
 *
 *   npx tsx spikes/s6-fidelity/score.ts
 *
 * It reads model outputs produced by the prototyping loop (Claude subagents
 * acting as "the model") from spikes/s6-fidelity/runs/ and reports three
 * things per shape, so OQ-24 can be answered with rates rather than opinion:
 *
 *   1. structural validity  — does the output parse against the real schema/?
 *   2. sourceRef resolution — do all canonical sourceRef.blockId values name a
 *                             block that actually exists in the snapshot?
 *   3. block-id stability   — across repeated runs on the SAME input, is the
 *                             set of snapshot block ids identical?
 *
 * Run-file naming convention (all under runs/):
 *   <shape>__<fixture>__<model>__run<NN>.json
 *     shape   = capture | normalization | combined
 *     fixture = the fixture key (matches a file in fixtures/ for the input)
 *     model   = short model label, e.g. opus48, sonnet, haiku
 *
 * Shapes:
 *   capture       → a SourceSnapshot        (measures stability only)
 *   normalization → a CanonicalRecipe       (measures validity + resolution
 *                     against the reference snapshot fixtures/<fixture>.snapshot.json)
 *   combined      → { snapshot, canonical } (measures validity of both,
 *                     stability of snapshot, resolution against OWN snapshot)
 */
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { CanonicalRecipe, SourceSnapshot } from "../../schema/index.js"

const here = dirname(fileURLToPath(import.meta.url))
const runsDir = join(here, "runs")
const fixturesDir = join(here, "fixtures")

type Shape = "capture" | "normalization" | "combined"

interface RunFile {
  readonly path: string
  readonly shape: Shape
  readonly fixture: string
  readonly model: string
  readonly run: string
}

function parseName(name: string): RunFile | null {
  const m = name.match(/^(capture|normalization|combined)__([^_]+(?:_[^_]+)*?)__([^_]+)__run(\d+)\.json$/)
  if (!m) return null
  return {
    path: join(runsDir, name),
    shape: m[1] as Shape,
    fixture: m[2],
    model: m[3],
    run: m[4],
  }
}

/** Recursively collect every `blockId` string anywhere in a canonical object. */
function collectBlockIds(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectBlockIds(item, out)
    return
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "blockId" && typeof v === "string") out.push(v)
      else collectBlockIds(v, out)
    }
  }
}

function snapshotBlockIds(snap: unknown): Set<string> {
  const ids = new Set<string>()
  if (snap && typeof snap === "object" && Array.isArray((snap as { blocks?: unknown }).blocks)) {
    for (const b of (snap as { blocks: unknown[] }).blocks) {
      if (b && typeof b === "object" && typeof (b as { id?: unknown }).id === "string") {
        ids.add((b as { id: string }).id)
      }
    }
  }
  return ids
}

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"))
}

function referenceSnapshot(fixture: string): unknown | null {
  try {
    return loadJson(join(fixturesDir, `${fixture}.snapshot.json`))
  } catch {
    return null
  }
}

interface Scored {
  readonly run: RunFile
  readonly valid: boolean
  readonly validityMsg: string
  /** null when resolution does not apply (capture shape). */
  readonly refsTotal: number | null
  readonly refsResolved: number | null
  readonly unresolved: readonly string[]
  /** snapshot block-id signature (sorted, joined) for stability grouping. */
  readonly blockIdSig: string | null
}

function scoreRun(rf: RunFile): Scored {
  const data = loadJson(rf.path)
  let valid = true
  const msgs: string[] = []
  let snapForRefs: unknown | null = null
  let canonical: unknown | null = null
  let blockIdSig: string | null = null

  if (rf.shape === "capture") {
    const r = SourceSnapshot.safeParse(data)
    if (!r.success) {
      valid = false
      msgs.push(`snapshot: ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`)
    }
    blockIdSig = [...snapshotBlockIds(data)].sort().join(",")
  } else if (rf.shape === "normalization") {
    const r = CanonicalRecipe.safeParse(data)
    if (!r.success) {
      valid = false
      msgs.push(`canonical: ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`)
    }
    canonical = data
    snapForRefs = referenceSnapshot(rf.fixture)
  } else {
    const obj = (data ?? {}) as { snapshot?: unknown; canonical?: unknown }
    const rs = SourceSnapshot.safeParse(obj.snapshot)
    if (!rs.success) {
      valid = false
      msgs.push(`snapshot: ${rs.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`)
    }
    const rc = CanonicalRecipe.safeParse(obj.canonical)
    if (!rc.success) {
      valid = false
      msgs.push(`canonical: ${rc.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`)
    }
    canonical = obj.canonical
    snapForRefs = obj.snapshot
    blockIdSig = [...snapshotBlockIds(obj.snapshot)].sort().join(",")
  }

  let refsTotal: number | null = null
  let refsResolved: number | null = null
  const unresolved: string[] = []
  if (canonical !== null) {
    const known = snapForRefs !== null ? snapshotBlockIds(snapForRefs) : new Set<string>()
    const ids: string[] = []
    collectBlockIds(canonical, ids)
    refsTotal = ids.length
    refsResolved = 0
    for (const id of ids) {
      if (known.has(id)) refsResolved++
      else unresolved.push(id)
    }
  }

  return {
    run: rf,
    valid,
    validityMsg: msgs.join(" | "),
    refsTotal,
    refsResolved,
    unresolved: [...new Set(unresolved)],
    blockIdSig,
  }
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(0)}%`
}

/**
 * Per-run cost metadata, written beside each run by `openai-run.ts`. Absent for
 * the Claude-side runs, which were produced by subagents and cost nothing.
 */
interface RunMeta {
  readonly latencyMs?: number
  readonly usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

function loadMeta(rf: RunFile): RunMeta | null {
  const path = rf.path.replace(/\.json$/, ".meta.json")
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RunMeta
  } catch {
    return null
  }
}

/**
 * Cost and latency PER SUCCESSFUL END-TO-END CONVERSION (CFV1-S6
 * `structured-output/latency-cost-per-conversion`).
 *
 * The distinction the criterion exists to force: you pay for a call whether or
 * not its output conforms, so dividing total spend by the number of ATTEMPTS
 * flatters a model that fails often. Dividing by the number of SUCCESSES is what
 * a caller actually pays to get one usable recipe, because a failed conversion
 * has to be retried.
 *
 * A two-call conversion succeeds only if BOTH stages conform, so capture and
 * normalization runs are paired by (fixture, run number) and the pair counts as
 * one conversion. A one-call conversion is the single `combined` run.
 */
function reportCost(scored: readonly Scored[]): void {
  const metas = new Map<string, RunMeta | null>()
  for (const s of scored) metas.set(s.run.path, loadMeta(s.run))
  const priced = scored.filter((s) => metas.get(s.run.path) !== null)
  if (priced.length === 0) return

  const models = [...new Set(priced.map((s) => s.run.model))].sort()
  console.log("# Cost and latency per successful conversion\n")
  console.log("Spend counts every attempt; successes count only conforming output, so a shape that")
  console.log("fails more often costs more per usable recipe even when its per-call figure is lower.\n")

  for (const model of models) {
    const forModel = priced.filter((s) => s.run.model === model)
    if (forModel.length === 0) continue
    const tok = (s: Scored) => {
      const u = metas.get(s.run.path)?.usage
      return (u?.prompt_tokens ?? 0) + (u?.completion_tokens ?? 0)
    }
    const ms = (s: Scored) => metas.get(s.run.path)?.latencyMs ?? 0

    // One-call: each `combined` run is one conversion attempt.
    const one = forModel.filter((s) => s.run.shape === "combined")
    // Two-call: pair capture with normalization on (fixture, runNo).
    const capture = forModel.filter((s) => s.run.shape === "capture")
    const norm = forModel.filter((s) => s.run.shape === "normalization")
    const key = (s: Scored) => `${s.run.fixture}#${s.run.run}`
    const normBy = new Map(norm.map((s) => [key(s), s]))
    const pairs = capture
      .map((c) => ({ c, n: normBy.get(key(c)) }))
      .filter((p): p is { c: Scored; n: Scored } => p.n !== undefined)

    const rows: {
      label: string
      attempts: number
      successes: number
      tokens: number
      latency: number
    }[] = []
    if (pairs.length > 0) {
      rows.push({
        label: "two-call",
        attempts: pairs.length,
        successes: pairs.filter((p) => p.c.valid && p.n.valid).length,
        tokens: capture.reduce((a, s) => a + tok(s), 0) + norm.reduce((a, s) => a + tok(s), 0),
        latency: pairs.reduce((a, p) => a + ms(p.c) + ms(p.n), 0),
      })
    }
    if (one.length > 0) {
      rows.push({
        label: "one-call",
        attempts: one.length,
        successes: one.filter((s) => s.valid).length,
        tokens: one.reduce((a, s) => a + tok(s), 0),
        latency: one.reduce((a, s) => a + ms(s), 0),
      })
    }
    if (rows.length === 0) continue

    console.log(`## ${model}`)
    for (const r of rows) {
      const perAttempt = Math.round(r.tokens / r.attempts)
      const perSuccess = r.successes > 0 ? Math.round(r.tokens / r.successes) : null
      const msSuccess = r.successes > 0 ? r.latency / r.successes / 1000 : null
      console.log(
        `   ${r.label.padEnd(9)} ${r.successes}/${r.attempts} conformed  ` +
          `per attempt ${perAttempt.toLocaleString()} tok  ` +
          `PER SUCCESS ${perSuccess === null ? "n/a" : perSuccess.toLocaleString()} tok` +
          `${msSuccess === null ? "" : `, ${msSuccess.toFixed(1)}s`}`,
      )
    }
    console.log("")
  }
}

function main(): void {
  const files = readdirSync(runsDir)
    .map(parseName)
    .filter((x): x is RunFile => x !== null)
  if (files.length === 0) {
    console.log("no run files under spikes/s6-fidelity/runs/ (naming: <shape>__<fixture>__<model>__runNN.json)")
    return
  }
  const scored = files.map(scoreRun)

  // Per (shape, fixture, model) aggregate.
  const groups = new Map<string, Scored[]>()
  for (const s of scored) {
    const key = `${s.run.shape} · ${s.run.fixture} · ${s.run.model}`
    const arr = groups.get(key) ?? []
    arr.push(s)
    groups.set(key, arr)
  }

  console.log(`# CFV1-S6 fidelity — ${scored.length} run(s), ${groups.size} cell(s)\n`)
  for (const [key, arr] of [...groups.entries()].sort()) {
    const validN = arr.filter((s) => s.valid).length
    const withRefs = arr.filter((s) => s.refsTotal !== null)
    const refTotal = withRefs.reduce((a, s) => a + (s.refsTotal ?? 0), 0)
    const refRes = withRefs.reduce((a, s) => a + (s.refsResolved ?? 0), 0)
    const runsFullyResolved = withRefs.filter((s) => (s.refsTotal ?? 0) > 0 && s.refsResolved === s.refsTotal).length
    const sigs = new Set(arr.map((s) => s.blockIdSig).filter((x): x is string => x !== null && x.length > 0))
    const stable = sigs.size <= 1

    console.log(`## ${key}  (n=${arr.length})`)
    console.log(`   valid:        ${validN}/${arr.length}`)
    if (withRefs.length > 0) {
      console.log(`   sourceRefs:   ${refRes}/${refTotal} resolved (${pct(refRes, refTotal)})`)
      console.log(`   runs w/ 100%: ${runsFullyResolved}/${withRefs.length}`)
    }
    if (sigs.size > 0) {
      console.log(`   block ids:    ${stable ? "STABLE" : `UNSTABLE (${sigs.size} distinct signatures)`}`)
    }
    for (const s of arr) {
      const bits: string[] = [`run${s.run.run}`]
      bits.push(s.valid ? "valid" : `INVALID(${s.validityMsg})`)
      if (s.refsTotal !== null) bits.push(`refs ${s.refsResolved}/${s.refsTotal}`)
      if (s.unresolved.length > 0) bits.push(`unresolved: ${s.unresolved.join(",")}`)
      console.log(`     - ${bits.join(" · ")}`)
    }
    console.log("")
  }

  reportCost(scored)
}

main()
