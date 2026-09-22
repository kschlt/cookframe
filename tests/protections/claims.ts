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

/**
 * WHAT THIS CANNOT SEE.
 *
 * Read this before trusting the name of the proof below. A judgement about
 * English cannot be made exhaustive, and a guard that documents every bound it
 * has while naming no gap invites a reader to take its id at face value — which
 * is the same defect as a proof named for a class it only partly covers, one
 * level up. So the gaps are listed here, deliberately, and they are not bugs.
 *
 * **A claim can be made without a configuring word at all.** These pass, and
 * are meant to:
 *
 *     This repository has secret scanning with push protection.
 *     Secret scanning protects this repository today.
 *
 * Catching them needs a rule about possession and about the present tense of
 * arbitrary verbs, and such a rule fires on honest prose — on the very
 * sentences elsewhere in this repository that describe what a protection would
 * do, or what the project intends. A guard that cries wolf gets weakened until
 * it matches nothing, so the bound is chosen and kept rather than discovered
 * later.
 *
 * **Other things not established in either direction**, and worth measuring
 * before anyone relies on them: whether a claim inside a fenced code block is
 * scanned at all (`blockOpener` treats a fence as a block opener, which is not
 * the same question); a claim spread across a markdown table's header and body
 * rows rather than within one row; and any phrasing not in English.
 *
 * **What this file is for, stated plainly:** it stops the accident this
 * repository already had — a stale or copied sentence asserting a setting is on
 * — not a determined author. Nothing here is a guarantee that the repository
 * makes no false claim about its protections; it is a guarantee about the
 * shapes enumerated above, and the record in `docs/repository-protections.md`
 * is what a reader is ultimately relying on.
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
 *
 * **Four shapes, because one was not enough, and that was a real defect.** The
 * first version recognised a copula followed by a predicate, and was named for
 * the whole class of claims. Review put fourteen phrasings through it and ten
 * were missed — five of them false statements about the one setting this
 * repository's own record says is OFF: "We have enabled secret scanning", "Secret
 * scanning with push protection: enabled", a table row reading
 * `| Secret scanning | enabled |`. A guard named for a class that recognises one
 * form of it is this project's recurring defect, met here from the inside.
 *
 * Every alternative below is bounded, and each was measured against every
 * markdown document in the tree before it was added: together they fire zero
 * times on the repository as it stands. That matters as much as the coverage —
 * a guard that cries wolf on honest prose gets weakened until it matches
 * nothing.
 */
/**
 * The words that say a setting was put into its configured state.
 *
 * All of them are past participles, which is what lets the shape below be a
 * bare participle rather than a sentence pattern: "we enabled it", "— enabled",
 * "(enabled)" and "is enabled" are the same claim wearing four costumes, and
 * enumerating the costumes is how the first two versions of this file went
 * wrong.
 */
const CONFIGURED = "enabled|configured|turned on|switched on|set up"

/**
 * Bare `on` and `active` are accepted only where they cannot mean something
 * else: `on` at a clause end ("secret scanning is on", never "Dependabot is on
 * the roadmap"), and either after a label separator. Unbounded, `on` reads every
 * mention of a setting being on *something* as a claim that it is switched on.
 */
const LABEL_SEPARATOR = "[:|—–]"

const CLAIM_VERBS = new RegExp(
  [
    // The participle alone, wherever it stands. This one shape replaces the
    // copula pattern, the active-voice pattern and the table-cell pattern that
    // stood here before, all three of which were spellings of it. `NOT_A_CLAIM`
    // and `NEGATED` below are what make it safe: a requirement and a denial are
    // filtered whatever grammar carries them, so the verb shape does not also
    // have to know grammar.
    `\\b(?:${CONFIGURED})\\b`,
    // "is active", "remains in place" — the states that are not participles.
    `\\b(?:is|are|be|been|was|were|remains?|stays?)\\b[^.;:!?]{0,40}?\\b(?:active|in place)\\b`,
    `\\b(?:is|are|remains?|stays?)\\b[^.;:!?]{0,20}?\\bon(?=\\s*(?:[.,;:!?)\\]|]|$))`,
    // "Secret scanning — active", "| Push protection | on |"
    `${LABEL_SEPARATOR}\\s*(?:active|on)\\b`,
    // A ticked checklist item or a check mark, which is how a security README
    // says it without a verb at all. The UNticked form must not match, so the
    // box is anchored to the start of the line.
    `^\\s*(?:[-*+]\\s*)?\\[[xX]\\]`,
    `[✅✔]`,
  ].join("|"),
  "i",
)

/**
 * Words that turn a statement into a requirement rather than a claim, and words
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

/** Does this line open a new markdown block rather than continue the last one? */
function blockOpener(line: string): boolean {
  return /^\s*$|^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>|\||```|~~~)/.test(line)
}

/**
 * Split into the units a claim can occupy.
 *
 * Two rules pull against each other here, and getting either one alone wrong was
 * a measured miss.
 *
 * **Line ends split**, because these documents are markdown: a bullet list is a
 * run of claims with no full stops between them, and joining two bullets into
 * one sentence lets a claim borrow the negation from its neighbour and vanish.
 *
 * **But a soft wrap is not a line end.** This repository wraps prose at 100
 * columns, which puts a copula on one line and its predicate on the next —
 * splitting there made `"Secret scanning is\nenabled."` invisible to a detector
 * whose whole job is to see it. So a line is joined to the one before unless it
 * opens a new block: a bullet, a numbered item, a heading, a quote, a table row
 * or a fence.
 */
function sentences(text: string): string[] {
  const unwrapped: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const previous = unwrapped.at(-1)
    if (previous === undefined || previous === "" || blockOpener(previous) || blockOpener(line)) {
      unwrapped.push(line)
    } else {
      unwrapped[unwrapped.length - 1] = `${previous} ${line.trim()}`
    }
  }
  return (
    unwrapped
      .join("\n")
      // A colon ends a sentence EXCEPT where it introduces a bare state word:
      // "Push protection: enabled" is one claim, and splitting it hands the label
      // to one fragment and the state to another, so the shape that reads a table
      // cell or a label never sees both halves. Measured — it was the last of the
      // reported phrasings still missed after the verb shapes were widened.
      .split(/(?<=[.!?;])\s+|(?<=:)\s+(?!(?:enabled|configured|active|on)\b)|\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s !== "")
  )
}

/**
 * A sentence, then each of its comma-separated clauses.
 *
 * "Branch protection is enabled, but secret scanning is not" is one sentence
 * holding a claim beside a denial, and testing the whole sentence lets the claim
 * borrow that `not` and disappear. This is the bullet-list failure one level
 * down; only the bullet half was closed the first time.
 *
 * The whole sentence stays in the list as well, because a claim can straddle a
 * comma ("Secret scanning, which we switched on last week, is enabled") and no
 * single clause would then carry both the mention and the predicate.
 */
function clauses(sentence: string): string[] {
  const parts = sentence.split(/,\s+(?=\w)/).map((c) => c.trim())
  return parts.length > 1 ? [sentence, ...parts] : [sentence]
}

/**
 * Every claim-shaped statement about a platform setting in `text`.
 *
 * A unit counts when it carries one of the verb shapes, mentions a setting, and
 * is neither a requirement nor a denial. A sentence and one of its clauses can
 * both match the same setting, so each setting is reported at most once per
 * sentence.
 */
export function findClaims(text: string): Claim[] {
  const found: Claim[] = []
  for (const sentence of sentences(text)) {
    const claimed = new Set<string>()
    for (const unit of clauses(sentence)) {
      if (!CLAIM_VERBS.test(unit)) continue
      if (NOT_A_CLAIM.test(unit) || NEGATED.test(unit)) continue
      for (const setting of PLATFORM_SETTINGS) {
        if (!setting.mentions.test(unit)) continue
        if (claimed.has(setting.heading)) continue
        claimed.add(setting.heading)
        found.push({ heading: setting.heading, sentence: unit })
      }
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
