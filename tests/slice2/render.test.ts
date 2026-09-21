/**
 * CFV1-SL2 — the library listing and the recipe page, rendered from Canonical.
 *
 * Each `describe` string is the acceptance-criterion proof id it satisfies.
 *
 * Two criteria are proven on the shape of the code rather than on a sample of
 * its output, because the slice's Hints ask for exactly that: "best proven by
 * making it structurally impossible to reach the source from a render path,
 * rather than by testing that a fetch does not happen". A test that renders one
 * recipe and finds no invented number says nothing about the next recipe; a
 * test that shows the render input carries no numbers at all says something
 * about every recipe.
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { CanonicalRecipe } from "../../schema/index.js"
import {
  recipeBody,
  renderLibraryPage,
  renderRecipePage,
  toLibraryCardView,
  toRecipeView,
} from "../../src/render/index.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const srcDir = join(repoRoot, "src")
const renderDir = join(srcDir, "render")

const loadFixture = (name: string): CanonicalRecipe =>
  CanonicalRecipe.parse(
    JSON.parse(readFileSync(join(repoRoot, "evals/fixtures/public/canonical", name), "utf8")),
  )

/** Exercises two contextual yields, a nutrition statement and an author. */
const gratin = loadFixture("two-yields-nutrition.json")
/** Exercises a range, a qualitative quantity, an open-ended rest and no author. */
const onions = loadFixture("ranges-and-qualitative.json")

const tsFilesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return tsFilesUnder(full)
    return entry.isFile() && entry.name.endsWith(".ts") ? [full] : []
  })

/** Every module specifier a file imports from, `import` and `export … from`. */
const importsOf = (file: string): string[] => {
  const text = readFileSync(file, "utf8")
  const specifiers: string[] = []
  const pattern = /(?:^|\n)\s*(?:import|export)\b[^\n;]*?from\s*["']([^"']+)["']/g
  for (const match of text.matchAll(pattern)) {
    const specifier = match[1]
    if (specifier !== undefined) specifiers.push(specifier)
  }
  const bare = /(?:^|\n)\s*import\s*["']([^"']+)["']/g
  for (const match of text.matchAll(bare)) {
    const specifier = match[1]
    if (specifier !== undefined) specifiers.push(specifier)
  }
  return specifiers
}

describe("slice2/usable-with-source-unavailable", () => {
  /**
   * The structural half. A render module may import the contract, the tagged-
   * template helpers, and its own siblings. It may NOT import persistence,
   * storage, the pipeline or the security layer — so there is no expression
   * anywhere under `src/render/` that could reach a Source Snapshot, a stored
   * byte or the original URL, whatever a future page decides it needs.
   */
  const ALLOWED = new Set(["../../schema/index.js", "hono/html", "hono/utils/html"])

  for (const file of tsFilesUnder(renderDir)) {
    it(`${relative(repoRoot, file)} imports no path to the source`, () => {
      const offenders = importsOf(file).filter(
        (specifier) => !specifier.startsWith("./") && !ALLOWED.has(specifier),
      )
      expect(offenders).toEqual([])
    })
  }

  it("the render barrel exposes no snapshot, storage or fetch entry point", async () => {
    const barrel = await import("../../src/render/index.js")
    const exported = Object.keys(barrel).join(" ").toLowerCase()
    for (const forbidden of ["snapshot", "fetch", "store", "repository", "bytes"]) {
      expect(exported).not.toContain(forbidden)
    }
  })

  it("a recipe renders in full with no network available", () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = (() => {
      throw new Error("the source is gone")
    }) as typeof globalThis.fetch
    try {
      const output = renderRecipePage(onions)
      expect(output).toContain("Eingelegte Zwiebeln")
      expect(output).toContain("Senfkörner")
      expect(output).toContain("Essig, Zucker und Senfkörner aufkochen")
      expect(output).toContain("Einmachglas")
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it("a stored hero image is omitted rather than guessed when nothing can serve it", () => {
    const withoutResolver = toRecipeView(onions)
    expect(withoutResolver.heroImage).toBeUndefined()
    expect(renderRecipePage(onions)).not.toContain("<img")

    const withResolver = renderRecipePage(onions, {
      mediaSrc: (identity) => `/media/${identity}`,
    })
    expect(withResolver).toContain('<img src="/media/sha256-')
  })

  it("no recipe field is left blank or filled in when the source did not state it", () => {
    // The onion fixture has no author and no publisher.
    const view = toRecipeView(onions)
    expect(view.authors).toEqual([])
    expect(view.sourceAttribution).toBe("Cookframe Fixtures")
    const card = toLibraryCardView(onions)
    expect(card.totalTime).toBe("1–2 Std.")

    // The gratin fixture has no `total` time; the listing shows none rather
    // than summing prep and cook into a number the source never stated.
    expect(toLibraryCardView(gratin).totalTime).toBeUndefined()
    expect(renderLibraryPage([gratin])).not.toContain("45 min")
  })
})

describe("slice2/deterministic-render", () => {
  it("the same Canonical Recipe renders byte-identically", () => {
    expect(renderRecipePage(onions)).toBe(renderRecipePage(onions))
    expect(renderRecipePage(gratin)).toBe(renderRecipePage(gratin))
  })

  it("the same library renders byte-identically, in input order", () => {
    const first = renderLibraryPage([gratin, onions])
    expect(first).toBe(renderLibraryPage([gratin, onions]))
    expect(first.indexOf("Kartoffelgratin")).toBeLessThan(first.indexOf("Eingelegte Zwiebeln"))
    expect(renderLibraryPage([onions, gratin])).not.toBe(first)
  })

  it("rendering a deep copy produces the same bytes as rendering the original", () => {
    const copy = CanonicalRecipe.parse(JSON.parse(JSON.stringify(onions)))
    expect(renderRecipePage(copy)).toBe(renderRecipePage(onions))
  })
})

describe("slice2/discovery-signals-visible", () => {
  const output = renderLibraryPage([gratin, onions])

  it("each saved recipe is listed by title and links to its page", () => {
    expect(output).toContain(">Kartoffelgratin</a>")
    expect(output).toContain(">Eingelegte Zwiebeln</a>")
    expect(output).toContain('href="/recipes/recipe-fixture-0001"')
  })

  it("the listing shows the source's own yield, time and classifications", () => {
    expect(output).toContain("4 servings as a side dish")
    expect(output).toContain("1–2 Std.")
    expect(output).toContain("Swiss")
    expect(output).toContain("Beilage")
    expect(output).toContain("eingelegt")
  })

  it("the listing shows attribution the source provided and invents none", () => {
    expect(output).toContain("Cookframe Fixture · Cookframe Fixtures")
    // The onion fixture has no author: its line carries the source name alone,
    // with no separator and no placeholder standing in for the missing author.
    expect(output).not.toContain("· Cookframe Fixtures ·")
    expect(output.toLowerCase()).not.toContain("unknown author")
  })

  it("an empty library says so rather than rendering an empty page", () => {
    expect(renderLibraryPage([])).toContain("No recipes saved yet.")
  })
})

/**
 * The structural guard behind both non-scalar criteria: the render input carries
 * no numbers at all. `ValueExpression` keeps `sourceText` beside `value`,
 * `minValue` and `maxValue`, and a formatter that can see those three is one
 * helper away from averaging them. The view model drops them, so the page cannot
 * coerce what it cannot reach.
 */
const numericLeaves = (value: unknown, path = "$"): string[] => {
  if (typeof value === "number") return [path]
  if (Array.isArray(value)) return value.flatMap((item, i) => numericLeaves(item, `${path}[${i}]`))
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => numericLeaves(item, `${path}.${key}`))
  }
  return []
}

describe("slice2/range-renders-as-range", () => {
  it("a range keeps the source's wording and gains no derived number", () => {
    const view = toRecipeView(onions)
    const mustard = view.ingredientGroups[0]?.ingredients.find((i) => i.id === "i-mustard")
    expect(mustard?.amount?.text).toBe("1–2 TL")

    expect(renderRecipePage(onions)).toContain('<span class="amount">1–2 TL</span> Senfkörner')

    // Scanned on the body rather than the whole document: the stylesheet is
    // this module's own literal, never carries recipe data, and legitimately
    // contains numbers that read as coercions out of context (`1.55`).
    const body = recipeBody(toRecipeView(onions)).toString()
    // 1.5 is the midpoint of 1–2 and 11 the midpoint of 10–12; neither was
    // written by the source, so neither may appear on the page.
    for (const invented of ["1.5", "1,5", "11 Min", "1.5 Std"]) {
      expect(body).not.toContain(invented)
    }
  })

  it("a range duration keeps its wording, in the step and in the listing", () => {
    expect(renderRecipePage(onions)).toContain("10–12 Min.")
    expect(renderLibraryPage([onions])).toContain("1–2 Std.")
    expect(renderLibraryPage([onions])).not.toContain("90 min")
  })

  it("the render input carries no numeric field a formatter could coerce", () => {
    expect(numericLeaves(toRecipeView(onions))).toEqual([])
    expect(numericLeaves(toRecipeView(gratin))).toEqual([])
    expect(numericLeaves(toLibraryCardView(onions))).toEqual([])
  })
})

describe("slice2/qualitative-quantity-wording-preserved", () => {
  it("a qualitative quantity renders as its wording, never as a number", () => {
    const view = toRecipeView(onions)
    const oil = view.ingredientGroups[0]?.ingredients.find((i) => i.id === "i-oil")
    expect(oil?.amount?.text).toBe("ein Schuss")

    const output = renderRecipePage(onions)
    expect(output).toContain('<span class="amount">ein Schuss</span> Olivenöl')
    expect(output).not.toMatch(/\d+\s*(ml|g|TL|EL)?\s*<\/span>\s*Olivenöl/)
  })

  it("an open-ended duration stays open-ended", () => {
    const output = renderRecipePage(onions)
    expect(output).toContain("über Nacht")
    expect(output).not.toContain("480 min")
    expect(output).not.toContain("8 h")
  })

  it("an approximate amount keeps its hedge", () => {
    expect(renderRecipePage(onions)).toContain("etwa 500 g")
  })

  it("an ingredient with no stated quantity renders without one", () => {
    const salt = toRecipeView(gratin).ingredientGroups[0]?.ingredients.find(
      (i) => i.id === "i-salt",
    )
    expect(salt?.amount).toBeUndefined()
    expect(renderRecipePage(gratin)).toContain("<li>Salz, nach Geschmack</li>")
  })
})

describe("slice2/no-client-runtime-in-output", () => {
  const pages = [renderRecipePage(onions), renderRecipePage(gratin), renderLibraryPage([onions])]

  it("no page carries a script, an event handler or hydration markup", () => {
    for (const output of pages) {
      expect(output).not.toContain("<script")
      expect(output).not.toMatch(/\son[a-z]+\s*=/i)
      expect(output).not.toContain("data-reactroot")
      expect(output).not.toContain("data-hydrate")
      expect(output).not.toContain("<!--$")
    }
  })

  it("recipe text cannot introduce one either", () => {
    const hostile = CanonicalRecipe.parse({
      ...JSON.parse(JSON.stringify(onions)),
      title: "<script>alert(1)</script>",
      description: '"><img src=x onerror=alert(1)>',
    })
    const output = renderRecipePage(hostile)
    // The point is not that the substring is absent but that no TAG and no
    // ATTRIBUTE can form: the angle brackets and quotes that would open one are
    // escaped, so the payload survives as visible text and runs nothing.
    expect(output).not.toContain("<script>alert(1)</script>")
    expect(output).not.toContain("<img src=x")
    expect(output).not.toMatch(/\son[a-z]+\s*=\s*["']/i)
    expect(output).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(output).toContain("&lt;img src=x onerror=alert(1)&gt;")
  })

  it("an injected media or link target cannot break out of its attribute", () => {
    const output = renderRecipePage(onions, {
      mediaSrc: () => '" onerror="alert(1)',
    })
    expect(output).not.toMatch(/\son[a-z]+\s*=\s*["']/i)
    expect(output).not.toContain('onerror="')
    expect(output).toContain("&quot; onerror=&quot;alert(1)")
  })
})

describe("slice2/no-jsx-or-component-system-imported", () => {
  /**
   * `ADR-0007` chooses `hono/html` tagged templates and names this exact erosion
   * risk: `hono/jsx` ships in the same package, so a component system is one
   * import line away, and taking it would settle `OQ-12` in passing and bias the
   * cooking UX spike.
   */
  const FORBIDDEN = [
    "hono/jsx",
    "hono/jsx-renderer",
    "react",
    "react-dom",
    "preact",
    "solid-js",
    "svelte",
    "vue",
    "lit",
    "lit-html",
    "@emotion/react",
    "styled-components",
  ]

  for (const file of tsFilesUnder(srcDir)) {
    it(`${relative(repoRoot, file)} imports no JSX runtime or component system`, () => {
      const offenders = importsOf(file).filter((specifier) =>
        FORBIDDEN.some((name) => specifier === name || specifier.startsWith(`${name}/`)),
      )
      expect(offenders).toEqual([])
    })
  }

  it("the compiler is not configured to accept JSX at all", () => {
    // The import bans above are the rule; this is the mechanism that makes the
    // rule hard to break by accident. With no `jsx` setting, a `.tsx` file does
    // not compile and JSX syntax in a `.ts` file is a syntax error, so the
    // component system cannot arrive without this line changing first.
    const tsconfig = JSON.parse(readFileSync(join(repoRoot, "tsconfig.json"), "utf8")) as {
      compilerOptions?: Record<string, unknown>
    }
    expect(tsconfig.compilerOptions?.jsx).toBeUndefined()
    expect(tsconfig.compilerOptions?.jsxImportSource).toBeUndefined()
    expect(
      readdirSync(srcDir, { recursive: true }).filter((n) => String(n).endsWith(".tsx")),
    ).toEqual([])
  })

  it("no component system is a dependency of the package", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>
    }
    const declared = Object.keys(pkg.dependencies ?? {})
    for (const name of FORBIDDEN) {
      expect(declared).not.toContain(name)
    }
  })
})
