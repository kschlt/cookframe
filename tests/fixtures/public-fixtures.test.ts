/**
 * Public fixture library conformance (CFV1-SL1 support).
 *
 * The repository ships synthetic/self-authored fixtures that other suites load
 * as data. Two things must hold and are easy to break silently: every fixture
 * must still conform to the versioned contract (a schema change or a hand-edit
 * can drift one out of shape), and every fixture must be LABELLED with its class
 * and origin in `evals/fixtures/public/README.md` — the copyright/sourcing
 * guarantee that nothing real slips into the public repo unlabelled.
 *
 * Each `describe`/`it` string is the proof id it satisfies.
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { CanonicalRecipe, SourceSnapshot } from "../../schema/index.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const publicDir = join(repoRoot, "evals", "fixtures", "public")

const jsonFilesIn = (dir: string): string[] =>
  readdirSync(join(publicDir, dir))
    .filter((n) => n.endsWith(".json"))
    .sort()

const load = (dir: string, file: string): unknown =>
  JSON.parse(readFileSync(join(publicDir, dir, file), "utf8"))

describe("fixtures/public-snapshots-conform", () => {
  const files = jsonFilesIn("source-snapshot")

  it("there is at least one source-snapshot fixture", () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(`source-snapshot/${file} parses and has unique block ids`, () => {
      const snapshot = SourceSnapshot.parse(load("source-snapshot", file))
      const ids = snapshot.blocks.map((b) => b.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  }
})

describe("fixtures/public-canonical-conform", () => {
  const files = jsonFilesIn("canonical")

  it("there is at least one canonical fixture", () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(`canonical/${file} parses against the contract`, () => {
      expect(() => CanonicalRecipe.parse(load("canonical", file))).not.toThrow()
    })
  }
})

describe("fixtures/every-fixture-is-labelled", () => {
  const readme = readFileSync(join(publicDir, "README.md"), "utf8")

  for (const dir of ["source-snapshot", "canonical"]) {
    for (const file of jsonFilesIn(dir)) {
      it(`${dir}/${file} is listed in the fixtures README`, () => {
        // The copyright/sourcing guarantee: no fixture ships without a
        // class + origin label, so a new fixture forces a README entry.
        expect(readme.includes(file)).toBe(true)
      })
    }
  }
})

describe("fixtures/no-fixture-names-a-real-source", () => {
  // The README states the guarantee in two halves — every fixture carries the
  // "Cookframe Fixtures" source name, and any URL it records sits on the
  // reserved `example.invalid` domain — while the labelling check above only
  // enforces that a file is listed. A fixture derived from a real page can
  // therefore be added, labelled, and still name the page it came from; that
  // happened while the Slice 6 fixtures were written. This closes it.
  const DECLARED_SOURCE_NAME = "Cookframe Fixtures"
  const url = /https?:\/\/([^/"\s]+)/g

  for (const dir of ["source-snapshot", "canonical"]) {
    for (const file of jsonFilesIn(dir)) {
      it(`${dir}/${file} names the fixture source and no real host`, () => {
        const raw = readFileSync(join(publicDir, dir, file), "utf8")
        const fixture = JSON.parse(raw) as { sourceName?: unknown }
        if (fixture.sourceName !== undefined) {
          expect(fixture.sourceName, `${file} names its own source`).toBe(DECLARED_SOURCE_NAME)
        }
        for (const [, host] of raw.matchAll(url)) {
          expect(host, `${file} records ${host}`).toMatch(/(^|\.)example\.invalid$/)
        }
      })
    }
  }

  it("rejects a fixture that names a real host", () => {
    // Without this the sweep could pass because the pattern finds no URL at all.
    const planted = '{"sourceUrl": "https://www.example.com/a-real-recipe/"}'
    const hosts = [...planted.matchAll(url)].map(([, host]) => host)
    expect(hosts).toEqual(["www.example.com"])
    expect(hosts[0]).not.toMatch(/(^|\.)example\.invalid$/)
  })
})
