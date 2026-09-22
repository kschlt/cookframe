/**
 * proof: cooking-ux/plain-html-prototype
 *
 * The prerequisite is load-bearing: a component system biases the answer toward
 * what it renders easily, which is why the item forbids one. "No dependency
 * manifest and no build step" is checked here rather than asserted, and so is
 * the thing that makes the prototype usable on a phone at all — one file that
 * opens from `file://` and fetches nothing.
 */
import { readdirSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { embeddedRecipeJson, prototypeHtml, recipesJson, spikeDir } from "./harness.js"

/** Anything the page would have to load over the network or off disk. */
const EXTERNAL_REF = /<script[^>]+\bsrc=|<link\b|@import\b|<iframe\b/i

describe("cooking-ux/plain-html-prototype", () => {
  it("ships no dependency manifest and nothing that needs building", () => {
    const entries = readdirSync(spikeDir)
    expect(entries.sort()).toEqual(["README.md", "prototype.html", "recipes.json"])
    for (const forbidden of [
      "package.json",
      "package-lock.json",
      "node_modules",
      "tsconfig.json",
    ]) {
      expect(entries, `${forbidden} would make this a build`).not.toContain(forbidden)
    }
  })

  it("loads nothing external, so it opens from a file on a phone", () => {
    expect(prototypeHtml()).not.toMatch(EXTERNAL_REF)
  })

  it("detects an external reference when there is one", () => {
    // Without this the assertion above could be green because the pattern is
    // wrong rather than because the prototype is clean.
    expect('<script src="https://cdn.example/x.js"></script>').toMatch(EXTERNAL_REF)
    expect('<link rel="stylesheet" href="x.css">').toMatch(EXTERNAL_REF)
  })

  it("keeps its embedded copy of the data identical to recipes.json", () => {
    expect(JSON.parse(embeddedRecipeJson())).toEqual(JSON.parse(recipesJson()))
    expect(embeddedRecipeJson().trim()).toBe(recipesJson().trim())
  })

  it("catches a drifted copy", () => {
    const drifted = embeddedRecipeJson().replace('"yield": "4 servings"', '"yield": "6 servings"')
    expect(drifted).not.toBe(embeddedRecipeJson())
    expect(JSON.parse(drifted)).not.toEqual(JSON.parse(recipesJson()))
  })
})
