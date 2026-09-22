/**
 * CFV1-PROT — what this repository is allowed to SAY about its own protections.
 *
 * The item this belongs to was cut three times, and the shape it ended in is the
 * only honest one available. A platform setting — secret scanning, push
 * protection, branch protection — is not repository content, and nothing here can
 * read one back. Measured 2026-09-22 from inside a GitHub Actions workflow, with
 * that workflow's own `GITHUB_TOKEN`:
 *
 *     GET /repos/kschlt/cookframe              200, with NO `security_and_analysis`
 *     GET .../branches/main/protection         403 Resource not accessible by integration
 *     GET .../vulnerability-alerts             403 Resource not accessible by integration
 *     GET .../automated-security-fixes         403 Resource not accessible by integration
 *
 * `permissions: administration: read` does not rescue it and cannot even be
 * declared: a workflow asking for it is rejected outright, its run failing with
 * zero jobs, while the identical file without that key runs green. Only a stored
 * admin token would work, and on a public, contribution-open repository that
 * token is a larger exposure than the setting it would prove.
 *
 * **So these proofs do not check the settings. They check the claims.** That
 * distinction is the whole point and is stated here rather than left for a reader
 * to discover: a green run below says nothing about whether secret scanning is
 * on. It says that no document in this repository tells anyone it is on without a
 * dated entry standing behind it.
 *
 * The failure that created the item was exactly that. `SECURITY.md` told the
 * public "Dependency update automation and branch protection are configured on
 * the repository itself" while there was no `.github/dependabot.yml` anywhere in
 * the tree — a false statement about security, in public, with nothing to catch
 * it.
 *
 * The rule itself is in `./claims.ts`; this file is only its proof.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { parse as parseYaml } from "yaml"
import {
  findClaims,
  PLATFORM_SETTINGS,
  parseRecord,
  RECORD_PATH,
  unbackedClaims,
} from "./claims.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** Every markdown document in the repository, except the record and the archive. */
function documents(): string[] {
  const found: string[] = []
  const skip = new Set(["node_modules", ".git", ".aos", "archive", "dist", "coverage"])
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith(".md")) found.push(relative(repoRoot, full))
    }
  }
  walk(repoRoot)
  return found.filter((p) => p !== RECORD_PATH).sort()
}

const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8")

describe("protections/no-unbacked-claim-about-a-setting", () => {
  it("tells a claim apart from a requirement and from a denial", () => {
    // NON-VACUITY, and it is first because without it everything below passes on
    // an empty repository. A detector that matched nothing would leave every
    // other case in this file green while guarding nothing at all — the shape
    // this project has been caught by three times.
    //
    // The strings are written out rather than read from the tree so that the
    // discrimination is pinned even when every real document is fixed.
    const claims = (s: string): number => findClaims(s).length

    // Claims. Each must be caught.
    expect(claims("Secret scanning is enabled on this repository.")).toBe(1)
    expect(claims("Branch protection and push protection are configured.")).toBe(2)
    expect(claims("Dependabot has been turned on.")).toBe(1)
    expect(claims("Dependency update automation is in place.")).toBe(1)

    // Requirements. The project says these are wanted; none says they exist.
    expect(claims("Secret scanning with push protection should be enabled.")).toBe(0)
    expect(claims("- secret scanning/push protection;")).toBe(0)
    expect(claims("A baseline that includes dependency scanning and Dependabot.")).toBe(0)
    expect(claims("Branch protection is worth having in place before there is much to push.")).toBe(
      0,
    )

    // A claim with a word between the copula and the predicate. This is why the
    // verb pattern tolerates a gap, and why the two filters below are needed at
    // all: an adjacency-only pattern misses this sentence entirely.
    expect(claims("Branch protection is currently enabled.")).toBe(1)
    expect(claims("Secret scanning has recently been turned on.")).toBe(1)

    // Requirements phrased with that same gap. These are what `NOT_A_CLAIM`
    // exists for; without it they read as claims.
    expect(claims("Branch protection must be configured before launch.")).toBe(0)
    expect(claims("Branch protection is worth having in place early.")).toBe(0)

    // Denials, which this repository now makes on purpose and must be free to.
    expect(claims("Secret scanning is not enabled.")).toBe(0)
    expect(claims("Branch protection has never been turned on.")).toBe(0)
    expect(claims("Branch protection cannot be read back, so it is not claimed here.")).toBe(0)

    // Bullets. A markdown list is a run of claims with no full stop between
    // them, so without the split on line ends this pair reads as one sentence
    // and the denial on the first line silences the claim on the second.
    // Mutation found it: removing the line split left every other case green.
    expect(claims("- Secret scanning is not enabled\n- Branch protection is enabled")).toBe(1)

    // And a sentence about none of these subjects is not a claim about them,
    // however assertively it is phrased.
    expect(claims("The url-fetch-security job is enabled on every pull request.")).toBe(0)
  })

  it("the record itself carries a state, a person and a date for every setting", () => {
    // Otherwise the backing is a filename. An entry trimmed to its heading would
    // still "exist" while saying nothing, and every claim resting on it would
    // stay green.
    const entries = parseRecord(read(RECORD_PATH))
    for (const setting of PLATFORM_SETTINGS) {
      const entry = entries.get(setting.heading)
      expect(entry, `${RECORD_PATH} has no complete entry for "${setting.heading}"`).toBeDefined()
      if (entry === undefined) continue

      // A state that is one of the two things it can be. "partially", "pending"
      // and "in progress" are how an unverified setting gets recorded as done.
      expect(entry.state, `"${setting.heading}" has an unreadable state`).toMatch(
        /^(?:enabled(?:, as repository content)?|not enabled)$/,
      )

      if (entry.state.startsWith("enabled")) {
        // Someone's name, and a real date. `—` is what the unverified entries
        // carry, and it must not satisfy a claim.
        expect(
          entry.verifiedBy,
          `"${setting.heading}" is enabled but nobody verified it`,
        ).not.toMatch(/^(?:—|-|nobody|nobody yet|n\/a|tbd)$/i)
        expect(entry.verifiedOn, `"${setting.heading}" is enabled with no date`).toMatch(
          /^\d{4}-\d{2}-\d{2}$/,
        )
      }
    }
  })

  it("says in its own words which settings no test reads", () => {
    // The criterion asks the entry to state this itself, and it is the sentence a
    // reader most needs: a page of green checkmarks that never says "nobody
    // checked this automatically" is the thing being guarded against.
    const entries = parseRecord(read(RECORD_PATH))
    const platformOnly = PLATFORM_SETTINGS.filter(
      (s) => s.heading !== "Dependency update automation",
    )
    for (const setting of platformOnly) {
      const entry = entries.get(setting.heading)
      expect(
        entry?.machineCheckable,
        `"${setting.heading}" does not say whether a test reads it`,
      ).toMatch(/^no\b.*\S/)
    }
    // And the one that IS readable says so, so "no" is a statement rather than
    // the only thing this field is ever set to.
    expect(entries.get("Dependency update automation")?.machineCheckable).toMatch(/^yes\b/)
  })

  it("rejects a claim the record does not back, and one that never cites it", () => {
    // END TO END over synthetic documents, because the real tree currently makes
    // no claim at all — so running the rule over the tree alone returns an empty
    // list whether the rule works or has been deleted. These three cases are what
    // make the case below mean something.
    const record = read(RECORD_PATH)

    // The exact sentence this repository published, restored as a fixture. It
    // names two settings; secret scanning is off, so that half must be rejected
    // however the document is written.
    const theOldClaim =
      "Dependency update automation and secret scanning are configured on the repository itself."
    expect(unbackedClaims([{ path: "FIXTURE.md", text: theOldClaim }], record)).toHaveLength(2)

    // A claim about a setting the record DOES back, but with no route to the
    // evidence from where the claim is made.
    expect(
      unbackedClaims([{ path: "FIXTURE.md", text: "Branch protection is enabled." }], record),
    ).toHaveLength(1)

    // A claim about a setting the record says is OFF, made by a document that
    // DOES cite the record. This is the case the two above cannot reach between
    // them: in both of those the citation is missing too, so every claim is
    // rejected for that reason alone and the state of the entry never decides
    // anything. Mutation found it — making a `not enabled` entry back a claim
    // survived both of them.
    expect(
      unbackedClaims(
        [
          {
            path: "FIXTURE.md",
            text: `Secret scanning is enabled; see ${RECORD_PATH}.`,
          },
        ],
        record,
      ),
    ).toHaveLength(1)

    // And an entry that has been trimmed to its heading backs nothing, however
    // enabled the one field it kept says it is. A record edited down to a title
    // would otherwise go on satisfying every claim that rested on it — the
    // failure mode of a parse that reads what is there and shrugs at what is
    // not.
    const trimmed = "## Branch protection on `main`\n\n- **State:** enabled\n"
    expect(
      unbackedClaims(
        [
          {
            path: "FIXTURE.md",
            text: `Branch protection is enabled; see ${RECORD_PATH}.`,
          },
        ],
        trimmed,
      ),
    ).toHaveLength(1)

    // The same claim, citing the record. This is the one shape that passes, and
    // it has to: a rule nothing can satisfy gets deleted.
    expect(
      unbackedClaims(
        [
          {
            path: "FIXTURE.md",
            text: `Branch protection is enabled; see ${RECORD_PATH} for who checked it.`,
          },
        ],
        record,
      ),
    ).toEqual([])
  })

  it("and no document in this repository breaks that rule today", () => {
    const docs = documents().map((path) => ({ path, text: read(path) }))
    // Non-vacuous in one direction at least: the walk reaches the file the
    // original false claim was published in.
    expect(docs.map((d) => d.path)).toContain("SECURITY.md")
    const unbacked = unbackedClaims(docs, read(RECORD_PATH))
    expect(unbacked, `unbacked claims:\n  ${unbacked.join("\n  ")}`).toEqual([])
  })
})

describe("protections/dependency-automation-is-in-the-tree", () => {
  it("is a file this test reads, not a setting it takes someone's word for", () => {
    // The point of the whole re-cut, in one case. A toggle would be unreadable
    // here; a file is not.
    const config = parseYaml(read(".github/dependabot.yml")) as {
      version?: number
      updates?: {
        "package-ecosystem"?: string
        directory?: string
        schedule?: { interval?: string }
      }[]
    }
    expect(config.version, "dependabot.yml is not a version 2 configuration").toBe(2)

    const updates = config.updates ?? []
    const ecosystems = updates.map((u) => u["package-ecosystem"])

    // npm is the product's own dependency tree: `npm ci` installs from the
    // lockfile in CI and in both images, so this is what a deployment gets.
    expect(ecosystems, "npm dependencies are not covered").toContain("npm")
    // A third-party action runs with the workflow's token, which makes the
    // workflows supply chain too, and the half more easily forgotten.
    expect(ecosystems, "the workflow actions are not covered").toContain("github-actions")

    // Every entry is complete enough to actually run. A block naming an ecosystem
    // with no schedule is configuration that reads as covered and updates
    // nothing.
    for (const update of updates) {
      expect(update.directory, `${update["package-ecosystem"]} has no directory`).toBeTruthy()
      expect(
        update.schedule?.interval,
        `${update["package-ecosystem"]} has no schedule interval`,
      ).toBeTruthy()
    }
  })

  it("and the record does not pretend this covers Dependabot's security alerts", () => {
    // Version updates and security alerts are different features; only the first
    // is a file. Conflating them would put back exactly the kind of claim this
    // item exists to remove, one layer deeper.
    const record = read(RECORD_PATH)
    expect(record).toMatch(/security alerts/i)
    expect(record).toMatch(/different features/i)
  })
})
