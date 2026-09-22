/**
 * CFV1-RRD — the widening is recorded as a supersession, declared on both sides
 * and justified by a named caller (ADR-0018).
 *
 * This proves the record, not the code: an accepted record is never rewritten, so
 * the five-operation interface (ADR-0003) is superseded by a new record that adds
 * one read, and the cross-link is set on both records as the ADR format requires.
 * The record must also name the caller that demanded the added read and explain
 * why the shopping aggregation — the other slice that hit the same wall — is NOT
 * added here.
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { parse as parseYaml } from "yaml"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const adrDir = join(repoRoot, "docs", "adr")

interface AdrFrontMatter {
  id?: string
  status?: string
  supersedes?: string[]
  superseded_by?: string[]
}

/** Locate an ADR file by its id prefix and return its front matter and body. */
function readAdr(idPrefix: string): { frontMatter: AdrFrontMatter; body: string } {
  const file = readdirSync(adrDir).find((f) => f.startsWith(`${idPrefix}-`) && f.endsWith(".md"))
  if (file === undefined) throw new Error(`no ADR file found for ${idPrefix}`)
  const text = readFileSync(join(adrDir, file), "utf8")
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (match === null) throw new Error(`ADR ${file} has no front matter`)
  return { frontMatter: parseYaml(match[1] as string) as AdrFrontMatter, body: match[2] as string }
}

describe("repo-reads/supersession-is-declared-and-justified", () => {
  const widening = readAdr("ADR-0018")
  const superseded = readAdr("ADR-0003")

  it("the new record supersedes the five-operation interface record", () => {
    expect(widening.frontMatter.id).toBe("ADR-0018")
    expect(widening.frontMatter.supersedes ?? []).toContain("ADR-0003")
    // `accepted` or `superseded`, not `proposed` and not `deprecated`. This
    // record was accepted, and the rule it is built on guarantees it will one
    // day be superseded in turn — the interface widens again the next time a
    // caller demands it (ADR-0025 is the first such time). Pinning it to
    // `accepted` would make this proof fail on the very event it describes,
    // and a proof that must be edited to stay true is not a guard.
    expect(["accepted", "superseded"]).toContain(widening.frontMatter.status)
  })

  it("declares its own supersession on both sides, if it has one", () => {
    // The chain is the thing under proof, not this one link: a record that has
    // been superseded names its successor, and the successor names it back.
    if (widening.frontMatter.status !== "superseded") return
    const successors = widening.frontMatter.superseded_by ?? []
    expect(successors.length, "superseded without naming a successor").toBeGreaterThan(0)
    for (const id of successors) {
      expect(readAdr(id).frontMatter.supersedes ?? [], id).toContain("ADR-0018")
    }
  })

  it("the superseded record declares the supersession on its side too", () => {
    expect(superseded.frontMatter.status).toBe("superseded")
    expect(superseded.frontMatter.superseded_by ?? []).toContain("ADR-0018")
  })

  it("names the added read and the caller that demanded it", () => {
    expect(widening.body).toMatch(/loadLatestCanonical/)
    // The caller is the shopping slice's capability-URL route.
    expect(widening.body).toMatch(/capability URL/i)
  })

  it("names the shopping aggregation as future need and says why it is not added here", () => {
    expect(widening.body).toMatch(/aggregat/i)
    // Justified by the guardrail this item is built on: no caller exists yet.
    expect(widening.body).toMatch(/no caller/i)
  })
})
