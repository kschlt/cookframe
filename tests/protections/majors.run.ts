/**
 * Run the major-bump plant lists for real: `npm run majors [-- <id> …]`.
 *
 * Not part of `npm run quality`, and the reason is arithmetic rather than
 * taste: every mutation is one vitest process, seventeen of them across eight
 * suites, and two of those suites start a server and talk to it over a real
 * socket. What the gate runs instead is `majors.test.ts`, which asks whether
 * the lists still describe the tree — see that file for the split.
 *
 * Run this when a dependency major moves. The answer it gives is the only one
 * that distinguishes "nothing broke" from "the guard stopped recognising what
 * it guards": every plant must be reported `killed`, at the assertion it names.
 * A `SURVIVED` line is a rule that is no longer held. An `INCONCLUSIVE` line is
 * worse than either, because it is the verdict an exit-code harness prints as a
 * pass.
 *
 * The exit code is non-zero unless every mutation was killed. Refusals count:
 * a refused mutation is not a passed one, it is a list that has drifted from
 * the tree.
 */
import { join } from "node:path"
import { MAJOR_HARNESSES, repoRoot } from "./majors.js"
import { formatReport, runMutations, vitestRunner } from "./mutation.js"

const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("-"))
const selected =
  requested.length === 0
    ? MAJOR_HARNESSES
    : MAJOR_HARNESSES.filter((harness) => requested.includes(harness.id))

if (selected.length === 0) {
  console.error(
    `no harness named ${requested.join(", ")}. Known: ${MAJOR_HARNESSES.map((h) => h.id).join(", ")}`,
  )
  process.exit(2)
}

let killed = 0
let notKilled = 0

for (const harness of selected) {
  console.log(`\n=== ${harness.id} (landed in ${harness.landedIn})`)
  console.log(`    ${harness.threat}\n`)
  for (const group of harness.groups) {
    console.log(`--- ${group.subject}  →  ${group.target}`)
    const report = runMutations(
      join(repoRoot, group.subject),
      group.mutations,
      group.target,
      vitestRunner(repoRoot),
    )
    console.log(formatReport(report))
    for (const result of report.results) {
      if (result.verdict.outcome === "killed") killed += 1
      else notKilled += 1
    }
    // A refusal is neither a kill nor a survival, and it must not be counted as
    // the first: it means this list no longer describes the tree, which is the
    // failure `majors.test.ts` exists to catch earlier than here.
    notKilled += report.refusals.length
    if (!report.baseline.usable) notKilled += group.mutations.length
  }
}

console.log(`\n${killed} killed, ${notKilled} not killed`)
process.exit(notKilled === 0 ? 0 : 1)
