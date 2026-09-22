/**
 * The three major-version bumps, as plants that live in the tree.
 *
 * A major bump is the one change a green gate says nothing about. The suite can
 * stay green because nothing broke, or because a guard stopped recognising what
 * it guards and now reports success over an empty set — and those two look
 * identical from the outside. Node 26 (#72), zod 4 (#76) and
 * `@hono/node-server` 2 (#77) were each settled the only way that distinguishes
 * them: plant the violation the guard names, against the NEW version, and
 * require the guard to go red at its own assertion.
 *
 * Each of those three runs happened in a session scratchpad, in a harness
 * written for the occasion, and went away with the session. So the evidence for
 * "these guards still bite on the new version" exists only as prose in three
 * merged pull request descriptions, and the next major has to rediscover the
 * plants from that prose. This file is the lists themselves, pointed at the
 * shared instrument in `mutation.ts` rather than at a fourth re-implementation
 * of it. `runMutations` takes its runner as a parameter, so a harness here is a
 * call into the instrument instead of a rebuild of it.
 *
 * WHAT THE GATE RUNS AND WHAT IT DOES NOT. Executing these means one vitest
 * process per mutation, which is minutes, so it is a command
 * (`npm run majors`) and not part of `npm run quality`. What the gate does run
 * is `majors.test.ts`: that every `find` still occurs exactly once in its
 * subject, and that every `mustFail` still names exactly one test in its
 * target. Those are `plant`'s refusal 2 and `decideMarker`'s refusal 4, asked
 * statically — and they are the two ways a list like this rots. A mutation
 * whose text has moved reports a survivor forever; a marker whose assertion was
 * renamed does the same. Both are silent, and both are now loud the day the
 * code moves rather than at the next major bump.
 *
 * WHAT A HARNESS HERE MAY NOT ASSERT, which is ADR-0029 applied to this file:
 * "no mutation survived" is a claim a broken instrument satisfies by finding
 * nothing, the same way a guard asserting an empty violation set is satisfied
 * by a detector that recognises nothing. So every mutation NAMES the assertion
 * that must object to it, `decideMutant` refuses any failure that is not that
 * assertion, and the report prints the full name of the test the marker
 * resolved to.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { HarnessReport, Mutation } from "./mutation.js"

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** Read a repo-relative file, for the plant lists and their own proofs alike. */
export const readFromRepo = (relative: string): string =>
  readFileSync(join(repoRoot, relative), "utf8")

/** One subject file, and the suite that must object to changes in it. */
export interface MutationGroup {
  /** Repo-relative path of the file the mutations are written into. */
  readonly subject: string
  /**
   * The vitest target that must go red — repo-relative, exactly as it is passed
   * on the command line.
   *
   * Narrow where a narrow target is honest: the point is that THIS suite
   * objects, and a whole-gate target would let some other proof's failure read
   * as a kill.
   */
  readonly target: string
  readonly mutations: readonly Mutation[]
}

/** One dependency major, with everything it threatened. */
export interface MajorHarness {
  /** How it is named on the command line: `npm run majors -- zod-4`. */
  readonly id: string
  /** What the bump put at risk, in one sentence. */
  readonly threat: string
  /** The pull request that took the bump, for the measurement behind it. */
  readonly landedIn: string
  readonly groups: readonly MutationGroup[]
}

// --- Node 26 (#72) ---------------------------------------------------------

/**
 * The Node major is written down in four kinds of place, and one guard compares
 * them instead of asserting any of them. Every plant below makes one of those
 * places disagree, or makes it silent — silence being the more dangerous of the
 * two, since a comparison over nothing is vacuously true.
 *
 * The two product plants are the other half. A guard written against Node 22's
 * behaviour can go on passing under 26 while no longer being about anything, so
 * the signal handler and the redirect policy are re-planted on the new runtime
 * rather than inherited from the old one.
 */
const NODE_26: MajorHarness = {
  id: "node-26",
  threat:
    "four places name a Node major and only one was pinned; a bump that moved some of them would certify the code on one runtime and ship another",
  landedIn: "#72",
  groups: [
    {
      subject: "Dockerfile",
      target: "tests/unit/repo-config.test.ts",
      mutations: [
        {
          name: "the CI image pins a different Node major than everything else",
          find: "FROM node:26-slim",
          replace: "FROM node:24-slim",
          mustFail: "every place that pins a Node version pins the same major",
        },
      ],
    },
    {
      subject: "Dockerfile.runtime",
      target: "tests/unit/repo-config.test.ts",
      mutations: [
        {
          name: "the runtime image an operator runs pins a different Node major",
          find: "FROM node:26-slim",
          replace: "FROM node:24-slim",
          mustFail: "every place that pins a Node version pins the same major",
        },
      ],
    },
    {
      subject: ".github/workflows/ci.yml",
      target: "tests/unit/repo-config.test.ts",
      mutations: [
        {
          // Anchored on the job header because nineteen `setup-node` steps are
          // byte-identical, and `plant` refuses text that occurs more than once
          // — correctly: an edit in nineteen places is not the edit it names.
          name: "one setup-node step pins a different major than the images",
          find: "  typecheck:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - uses: actions/setup-node@v7\n        with:\n          node-version: 26",
          replace:
            "  typecheck:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - uses: actions/setup-node@v7\n        with:\n          node-version: 24",
          mustFail: "every place that pins a Node version pins the same major",
        },
        {
          name: "a setup-node step sets Node up without naming a version",
          find: "  typecheck:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - uses: actions/setup-node@v7\n        with:\n          node-version: 26\n",
          replace:
            "  typecheck:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - uses: actions/setup-node@v7\n        with:\n",
          mustFail: "every place that pins a Node version pins the same major",
        },
      ],
    },
    {
      subject: "package.json",
      target: "tests/unit/repo-config.test.ts",
      mutations: [
        {
          name: "engines.node keeps a floor below what the gate runs on",
          find: '"node": ">=26"',
          replace: '"node": ">=22"',
          mustFail: "every place that pins a Node version pins the same major",
        },
        {
          name: "engines.node declares no >=N floor at all",
          find: '"node": ">=26"',
          replace: '"node": "26.x"',
          mustFail: "every place that pins a Node version pins the same major",
        },
        {
          name: "the declared @types/node major drifts above the runtime",
          find: '"@types/node": "^26.6.2"',
          replace: '"@types/node": "^27.0.0"',
          mustFail: "every place that pins a Node version pins the same major",
        },
        {
          name: "the @types/node caret range is gone, so its major cannot be read",
          find: '"@types/node": "^26.6.2"',
          replace: '"@types/node": "latest"',
          mustFail: "every place that pins a Node version pins the same major",
        },
      ],
    },
    {
      subject: "src/server/main.ts",
      target: "tests/run/process.test.ts",
      mutations: [
        {
          name: "the SIGTERM handler is gone, on the new runtime",
          find: '  process.on("SIGTERM", () => stop("SIGTERM"))\n',
          replace: "",
          mustFail: "starts from the declared command, answers on a real socket, and stops cleanly",
        },
      ],
    },
    {
      subject: "src/security/safe-fetch.ts",
      target: "tests/url-fetch/url-security.connector.test.ts",
      mutations: [
        {
          // Named at the per-hop revalidation proof, which is the defect: when
          // the fetcher follows a redirect itself, no hop after the first is
          // examined at all. Measured, this plant reddens five proofs here.
          //
          // It could not be named when this list was ported. The proof was then
          // called `url-security/redirect-revalidation`, a PREFIX of its sibling
          // `… (named host re-classified on connect)`, and a marker is a
          // substring: the short name matched both, `decideMarker` refused it,
          // and naming the long one came back INCONCLUSIVE because that sibling
          // does not fail under this plant. The plant sat at the scheme check
          // instead. The proofs have been renamed since, and
          // `protections/every-proof-can-be-named` keeps the shape from coming
          // back.
          name: "the fetcher follows redirects itself instead of revalidating each hop",
          find: '      redirect: "manual",',
          replace: '      redirect: "follow",',
          mustFail: "url-security/redirect-revalidation (a later hop to a private literal)",
        },
      ],
    },
  ],
}

// --- zod 4 (#76) -----------------------------------------------------------

/**
 * Five proofs here work by walking a schema's own structure, and two of them
 * read Zod's internals. `tsc --noEmit` was clean against zod 4 with no source
 * change at all, so the signal a bump is usually judged on said nothing.
 *
 * The finding that gives this list its shape: of the two internals walks, one
 * broke LOUDLY with a `TypeError` and the other broke SILENTLY — under v4 it
 * recognised nothing, and every assertion about what the contract must not
 * declare would have passed over an empty set. Which one breaks loudly is an
 * accident of which key disappears first, never a property. So the plants below
 * are not "does it still run" but "does it still REACH", and several name a key
 * that is only reachable through the part of the walk being removed.
 */
const ZOD_4: MajorHarness = {
  id: "zod-4",
  threat:
    "five proofs walk a schema's structure and two read Zod's internals; under v4 a walk can recognise nothing and report success over an empty set, with a clean typecheck",
  landedIn: "#76",
  groups: [
    {
      subject: "tests/schema/required-fields.contract.test.ts",
      target: "tests/schema/required-fields.contract.test.ts",
      mutations: [
        {
          name: "the object shape key moved, so the walk descends into no object",
          find: "    const shape = current._def.shape\n",
          replace:
            "    const shape = (current._def as unknown as { shapeOf?: Record<string, ZodInternals> })\n      .shapeOf\n",
          mustFail:
            "the contract requires exactly the ungrounded fields that carry no source content",
        },
        {
          name: "an array's element is read by v3's key, so the walk stops at arrays",
          find: '    else if (type === "array" && element !== undefined) current = element\n',
          replace: '    else if (type === "array") return current\n',
          mustFail:
            "the contract requires exactly the ungrounded fields that carry no source content",
        },
        {
          name: "a literal is read by v3's key, so union branches lose their names",
          find: "          discriminant === undefined ? undefined : unwrap(discriminant)._def.values?.[0]",
          replace:
            "          discriminant === undefined\n            ? undefined\n            : (unwrap(discriminant)._def as unknown as { value?: unknown }).value",
          mustFail:
            "the contract requires exactly the ungrounded fields that carry no source content",
        },
      ],
    },
    {
      subject: "tests/slice6/no-fabrication.test.ts",
      target: "tests/slice6/no-fabrication.test.ts",
      mutations: [
        {
          name: "the plan contract walk reads a shape key that moved, and finds nothing",
          find: "    const shape = def.shape\n",
          replace: "    const shape = def.shapeOf\n",
          mustFail: "declares no numeric field anywhere in the plan contract",
        },
        {
          // The one that proves the size bound is not the floor doing the work.
          // Reading the wrapper keys as v3 named them leaves the walk finding
          // nineteen keys — past `> 15` — while it has silently stopped
          // descending into arrays.
          name: "the single-child wrapper keys revert to v3, so the walk stops at arrays",
          find: '    for (const nested of ["innerType", "element", "valueType", "in", "out"]) {',
          replace: '    for (const nested of ["innerType", "type", "valueType", "in", "out"]) {',
          mustFail: "declares no numeric field anywhere in the plan contract",
        },
      ],
    },
    {
      subject: "tests/schema/finite-number.contract.test.ts",
      target: "tests/schema/finite-number.contract.test.ts",
      mutations: [
        {
          name: "the numeric-field sweep discovers no field, so it checks nothing",
          find: "  return Object.keys(schema.shape).filter(",
          replace: "  return Object.keys({} as Record<string, unknown>).filter(",
          mustFail: "ValueExpression exposes numeric fields to check",
        },
      ],
    },
    {
      subject: "tests/injection/prompt-boundary.test.ts",
      target: "tests/injection/prompt-boundary.test.ts",
      mutations: [
        {
          name: "the snapshot's shape reads empty, so the fixture varies nothing",
          find: "    ).toEqual(Object.keys(SourceSnapshot.shape).sort())",
          replace: "    ).toEqual(Object.keys({} as Record<string, unknown>).sort())",
          mustFail: "the fixture varies every field of the contract the source controls",
        },
      ],
    },
    {
      subject: "tests/slice6/follows-s4-findings.test.ts",
      target: "tests/slice6/follows-s4-findings.test.ts",
      mutations: [
        {
          name: "the placement enum's options read empty",
          find: "    const placements = PlanDerivation.shape.quantityPlacement.options",
          replace: "    const placements = [] as readonly string[]",
          mustFail:
            "derives S4's recommended layout, and records which layout the plan was derived under",
        },
      ],
    },
  ],
}

// --- @hono/node-server 2 (#77) ---------------------------------------------

/**
 * This adapter is not an ordinary dependency here: it is where CFV1-HDR's
 * defect lives. It writes the content length back into the very record a
 * handler passed to `c.body(...)`, so a one-key record reused across responses
 * is poisoned by the first response and every one after it is a 500. Two guards
 * and one un-exported constant exist because of that.
 *
 * A green suite decides nothing here, and that is worth being precise about:
 * every guard in question would stay green if the adapter had quietly STOPPED
 * mutating the caller's record, because the proofs assert that responses
 * survive repetition and they survive it trivially once there is nothing to
 * poison. What settles the bump is whether the defect still reproduces. It
 * does — `[200, 500, 500]` over a real socket, and the line is still in the
 * adapter's own source at a new line number — so the copying stays, and these
 * plants are what hold it.
 */
const HONO_NODE_SERVER_2: MajorHarness = {
  id: "hono-node-server-2",
  threat:
    "the adapter writes content length back into the caller's header record, so a shared record is poisoned after its first response; two guards and one un-exported constant exist only for that",
  landedIn: "#77",
  groups: [
    {
      subject: "src/http/not-found.ts",
      target: "tests/run/served-headers-survive-repetition.test.ts",
      mutations: [
        {
          name: "the miss helper hands out its constant instead of a copy",
          find: "  return { ...NOT_FOUND_HEADERS }",
          replace: "  return NOT_FOUND_HEADERS as unknown as Record<string, string>",
          mustFail: "serves the same miss over and over, never a 500, over a real socket",
        },
      ],
    },
    {
      subject: "src/server/instance.ts",
      target: "tests/unit/response-header-record.test.ts",
      mutations: [
        {
          name: "a real call site hands c.body a module-level record",
          find: "  app.notFound((c) => c.body(NOT_FOUND_BODY, NOT_FOUND_STATUS, notFoundHeaders()))",
          replace:
            'const SHARED_MISS_HEADERS = { "content-type": "text/plain; charset=utf-8" }\n  app.notFound((c) => c.body(NOT_FOUND_BODY, NOT_FOUND_STATUS, SHARED_MISS_HEADERS))',
          mustFail: "hands no response builder in src/ a header record shared across responses",
        },
      ],
    },
    {
      subject: "src/http/pages-app.ts",
      target: "tests/unit/response-header-record.test.ts",
      mutations: [
        {
          name: "a page call site hands c.body the shared two-key record",
          find: "    return c.body(renderLibraryPage(recipes), 200, pageHeaders())",
          replace: "    return c.body(renderLibraryPage(recipes), 200, PAGE_HEADERS)",
          mustFail: "hands no response builder in src/ a header record shared across responses",
        },
      ],
    },
    {
      subject: "src/server/main.ts",
      target: "tests/run/process.test.ts",
      mutations: [
        {
          // The same plant as the Node harness's last one, deliberately, and
          // not a duplicate to be removed: the adapter is what the shutdown
          // path closes, so this bump is a reason to re-measure the signal
          // handler on ITS OWN terms. Sharing the text is not sharing the
          // question.
          name: "the SIGTERM handler is gone, with the new adapter underneath it",
          find: '  process.on("SIGTERM", () => stop("SIGTERM"))\n',
          replace: "",
          mustFail: "starts from the declared command, answers on a real socket, and stops cleanly",
        },
      ],
    },
  ],
}

/** Every harness, by the id the command line names. */
export const MAJOR_HARNESSES: readonly MajorHarness[] = [NODE_26, ZOD_4, HONO_NODE_SERVER_2]

// --- has a list stopped describing the tree? ------------------------------

/**
 * One way a plant list has stopped describing the tree.
 *
 * `where` carries the harness and the mutation by name, because a problem a
 * reader cannot locate is a problem nobody acts on.
 */
export interface Rot {
  readonly where: string
  readonly kind: "find-absent" | "find-ambiguous" | "marker-absent" | "marker-ambiguous"
}

/**
 * The one marker that is composed at run time and therefore cannot be found in
 * its target's source.
 *
 * `finite-number.contract.test.ts` names its cases from a table —
 * `` it(`${name} exposes numeric fields to check (the sweep is not vacuous)`) ``
 * — so the string vitest reports exists only once the file has been evaluated.
 * The check below would call it absent, which would be a false alarm rather
 * than a finding.
 *
 * It is a SET, asserted by name in its own proof, rather than a condition
 * written into the checker: an exemption nobody can see is how a check dies.
 * `decideMarker` still holds this one at run time, against the baseline's real
 * test names, which is the stronger check and the reason a static exemption
 * costs nothing here.
 */
export const COMPOSED_AT_RUN_TIME: ReadonlySet<string> = new Set([
  "ValueExpression exposes numeric fields to check",
])

/** Read a file, or report it as missing rather than throwing. */
export type ReadFile = (relative: string) => string

/**
 * Every way `harness` no longer describes the tree `read` exposes.
 *
 * Pure over a reader so the table below can hand it broken harnesses and real
 * file contents, instead of proving itself against whatever the repository
 * happens to contain today. A checker whose only subject is the real tree
 * passes the day the last violation is deleted and never speaks again.
 */
export function rotIn(harness: MajorHarness, read: ReadFile): Rot[] {
  const found: Rot[] = []
  const occurrences = (haystack: string, needle: string): number =>
    haystack.split(needle).length - 1

  for (const group of harness.groups) {
    const subject = read(group.subject)
    const target = read(group.target)
    for (const mutation of group.mutations) {
      const where = `${harness.id} › ${group.subject} › ${mutation.name}`
      const hits = occurrences(subject, mutation.find)
      if (hits === 0) found.push({ where, kind: "find-absent" })
      else if (hits > 1) found.push({ where, kind: "find-ambiguous" })

      if (COMPOSED_AT_RUN_TIME.has(mutation.mustFail)) continue
      const named = occurrences(target, mutation.mustFail)
      if (named === 0) found.push({ where, kind: "marker-absent" })
      else if (named > 1) found.push({ where, kind: "marker-ambiguous" })
    }
  }
  return found
}

// --- The run's arithmetic ---------------------------------------------------

/** How many of a group's planned mutations were killed, and how many were not. */
export interface Tally {
  readonly killed: number
  readonly notKilled: number
}

/**
 * Count one group's report against the mutations it PLANNED.
 *
 * Only a `killed` verdict counts as a kill. Everything else a planned mutation
 * can become is "not killed", and each of them is one: a survivor, an
 * inconclusive run, a refusal (the list no longer describes the tree), and every
 * mutation of a group whose baseline was refused, which ran none of them.
 *
 * The count is taken against `planned`, not against what the report happens to
 * contain, so a mutation the report lost is not killed rather than absent. A
 * report that accounts for a different number than was planned — results plus
 * refusals — is not a reading of this group at all, and none of it counts as a
 * kill.
 */
export function tallyGroup(report: HarnessReport, planned: number): Tally {
  if (!report.baseline.usable) return { killed: 0, notKilled: planned }
  if (report.results.length + report.refusals.length !== planned) {
    return { killed: 0, notKilled: planned }
  }
  const killed = report.results.filter((r) => r.verdict.outcome === "killed").length
  return { killed, notKilled: planned - killed }
}

/** The tallies of a whole run, added up. */
export function sumTallies(tallies: readonly Tally[]): Tally {
  return tallies.reduce(
    (sum, t) => ({ killed: sum.killed + t.killed, notKilled: sum.notKilled + t.notKilled }),
    { killed: 0, notKilled: 0 },
  )
}

/**
 * The exit code of `npm run majors`: 0 only when every planned mutation was
 * killed AND at least one was. A run that killed nothing and missed nothing ran
 * nothing, and that is the one result an exit code must never report as a pass.
 */
export function exitCodeFor(total: Tally): 0 | 1 {
  return total.notKilled === 0 && total.killed > 0 ? 0 : 1
}
