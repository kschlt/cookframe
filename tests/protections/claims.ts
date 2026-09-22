/**
 * CFV1-PROT — the detector, as a module rather than as exports from a test file.
 *
 * It lives here for two reasons, the second the real one:
 *
 * 1. `lint/suspicious/noExportsInTest` forbids exporting from a `.test.ts`, and
 *    the proofs below need these symbols.
 * 2. More to the point, this file is the thing under test. The rule it
 *    implements — "no document may say a platform setting is configured unless
 *    `docs/repository-protections.md` carries a dated entry for it" — is a
 *    judgement about English, and a judgement about English is exactly the kind
 *    of code that passes review by reading well and then matches nothing.
 *    `repository-claims.test.ts` proves it discriminates, on written-out strings
 *    rather than on the tree, so the discrimination stays pinned after every
 *    real document is fixed.
 *
 * Nothing here reads a GitHub setting, and nothing here can. Measured
 * 2026-09-22 from inside a GitHub Actions workflow with that workflow's own
 * `GITHUB_TOKEN`: the repository object arrives with no `security_and_analysis`
 * block, and `/branches/main/protection`, `/vulnerability-alerts` and
 * `/automated-security-fixes` all answer `403 Resource not accessible by
 * integration`. `docs/repository-protections.md` carries the full measurement.
 */

/** The dated entry every claim must stand on. */
export const RECORD_PATH = "docs/repository-protections.md"

/**
 * A setting that lives on GitHub rather than in this tree, with the words a
 * document might use for it and the heading the record files it under.
 *
 * `dependency update automation` is on this list although it is now a file. That
 * is deliberate: it is the subject the false claim was made about, and dropping
 * it once it was fixed would remove the guard from the one place it has already
 * failed.
 */
export interface PlatformSetting {
  readonly heading: string
  readonly mentions: RegExp
}

export const PLATFORM_SETTINGS: readonly PlatformSetting[] = [
  { heading: "Branch protection on `main`", mentions: /branch protection/i },
  { heading: "Secret scanning with push protection", mentions: /secret scanning|push protection/i },
  {
    heading: "Dependency update automation",
    mentions: /dependabot|dependency update automation/i,
  },
]

/**
 * Saying a setting IS configured. Not saying it should be, could be, or is not.
 *
 * The distinction carries real weight in this repository:
 * `docs/open-source-self-hosting-principles.md` §5 lists "secret scanning/push
 * protection" as part of a baseline the project intends to meet, and
 * `ADR-0007` reasons about a baseline that "includes dependency scanning and
 * Dependabot". Neither asserts that anything is switched on, and a guard that
 * could not tell the difference would either fire on both — pushing someone to
 * weaken it until it fired on nothing — or be tuned until it fired on nothing at
 * all. `findClaims` below is proved to discriminate rather than assumed to.
 */
const CLAIM_VERBS =
  /\b(?:is|are|be|been|was|were)\b[^.;:!?]{0,40}?\b(?:enabled|configured|turned on|switched on|set up|active|in place)\b/i

/**
 * Words that turn a sentence into a requirement rather than a claim, and words
 * that turn it into a denial.
 *
 * Both filters are load-bearing ONLY because `CLAIM_VERBS` above tolerates a gap
 * between the copula and the predicate. An earlier version required them to be
 * adjacent, which read well and was wrong twice over: it silently missed
 * "branch protection is currently enabled", a claim in every sense, and it made
 * these two filters dead code that looked like guards. Mutation testing found it
 * — deleting either one changed nothing — which is the same defect this project
 * keeps finding, arrived at from the inside.
 *
 * `worth` earns its place here: "branch protection is worth having in place"
 * matches the verb pattern and is a recommendation, not a statement of fact.
 */
const NOT_A_CLAIM =
  /\b(?:should|must|shall|will|would|could|worth|needs? to|intends? to|plans? to)\b/i
const NEGATED = /\b(?:not|never|no longer|cannot|can't|isn't|aren't|without)\b/i

export interface Claim {
  readonly heading: string
  readonly sentence: string
}

/**
 * Split on sentence ends AND on line ends.
 *
 * The line split matters more than the sentence split here, because the documents
 * this reads are markdown: a bullet list is a run of claims with no full stops
 * between them, and joining two bullets into one "sentence" would let a claim
 * borrow the negation from its neighbour and disappear.
 */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?:;])\s+|\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s !== "")
}

/** Every claim-shaped statement about a platform setting in `text`. */
export function findClaims(text: string): Claim[] {
  const found: Claim[] = []
  for (const sentence of sentences(text)) {
    if (!CLAIM_VERBS.test(sentence)) continue
    if (NOT_A_CLAIM.test(sentence) || NEGATED.test(sentence)) continue
    for (const setting of PLATFORM_SETTINGS) {
      if (setting.mentions.test(sentence)) found.push({ heading: setting.heading, sentence })
    }
  }
  return found
}

/** One setting's entry in the record. */
export interface RecordEntry {
  readonly state: string
  readonly verifiedBy: string
  readonly verifiedOn: string
  readonly machineCheckable: string
}

/**
 * Read the record's entries.
 *
 * Deliberately strict about shape: an entry missing a field is absent rather than
 * partially present, so a record that is edited down to a heading stops backing
 * the claims that rested on it instead of continuing to satisfy a looser parse.
 */
export function parseRecord(text: string): Map<string, RecordEntry> {
  const entries = new Map<string, RecordEntry>()
  const sections = text.split(/^## /m).slice(1)
  for (const section of sections) {
    const heading = (section.split(/\r?\n/)[0] ?? "").trim()
    const field = (name: string): string | undefined =>
      new RegExp(`^- \\*\\*${name}:\\*\\*\\s*(.+)$`, "m").exec(section)?.[1]?.trim()
    const state = field("State")
    const verifiedBy = field("Verified by")
    const verifiedOn = field("Verified on")
    const machineCheckable = field("Machine-checkable")
    if (
      state === undefined ||
      verifiedBy === undefined ||
      verifiedOn === undefined ||
      machineCheckable === undefined
    ) {
      continue
    }
    entries.set(heading, { state, verifiedBy, verifiedOn, machineCheckable })
  }
  return entries
}

/** A document as this guard sees it: a path and its text. */
export interface Document {
  readonly path: string
  readonly text: string
}

/**
 * The backing rule itself, over documents handed in rather than read from disk.
 *
 * Separated for one reason: today this repository makes NO claim about any
 * platform setting, so running this over the real tree returns an empty list
 * whatever the rule says — including if the rule says nothing. Passing the tree
 * through the same function that a synthetic pair of documents is passed through
 * is what stops "no claims found" from being indistinguishable from "no rule".
 */
export function unbackedClaims(docs: readonly Document[], recordText: string): string[] {
  const entries = parseRecord(recordText)
  const unbacked: string[] = []
  for (const doc of docs) {
    const claims = findClaims(doc.text)
    if (claims.length === 0) continue
    const citesRecord = doc.text.includes(RECORD_PATH)
    for (const claim of claims) {
      const entry = entries.get(claim.heading)
      if (entry === undefined || !entry.state.startsWith("enabled")) {
        unbacked.push(
          `${doc.path}: claims "${claim.heading}" is configured, record does not back it\n    ${claim.sentence}`,
        )
      } else if (!citesRecord) {
        unbacked.push(
          `${doc.path}: claims "${claim.heading}" is configured but never links ${RECORD_PATH}\n    ${claim.sentence}`,
        )
      }
    }
  }
  return unbacked
}
