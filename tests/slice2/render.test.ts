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
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { CanonicalRecipe } from "../../schema/index.js"
import {
  libraryBody,
  page,
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

/**
 * Every module specifier a file imports from.
 *
 * Read with the TypeScript compiler's own pre-processor rather than a regular
 * expression. A hand-rolled pattern was the first version of this and it had a
 * hole a review found: it required `from "…"` to sit on the same line as the
 * `import` keyword, so a multi-line import — the prevailing style in this very
 * tree — was invisible to it, and a three-line `import … from "hono/jsx"`
 * passed every guard below. The compiler sees what the compiler sees, including
 * `export … from`, side-effect imports and dynamic `import()`, which is the
 * point: these two describes are structural guarantees, and a guarantee that a
 * line break defeats is not one.
 */
const importsOf = (file: string): string[] =>
  ts.preProcessFile(readFileSync(file, "utf8"), true, true).importedFiles.map((i) => i.fileName)

describe("slice2/import-scanner-sees-every-form", () => {
  /**
   * The scanner is load-bearing for two criteria, so it gets its own proof. A
   * guard is only as strong as its ability to see what it is guarding against.
   */
  const scan = (source: string): string[] => {
    const tmp = join(repoRoot, "node_modules", ".slice2-scan-fixture.ts")
    writeFileSync(tmp, source)
    try {
      return importsOf(tmp)
    } finally {
      rmSync(tmp, { force: true })
    }
  }

  it("sees a multi-line import, which a line-anchored pattern misses", () => {
    expect(scan('import {\n  jsx,\n} from "hono/jsx"\nconst a = 1\nexport default a\n')).toContain(
      "hono/jsx",
    )
  })

  it("sees a side-effect import, an export-from and a dynamic import", () => {
    const found = scan(
      'import "react"\nexport * from "preact"\nconst m = () => import("solid-js")\nexport default m\n',
    )
    expect(found).toEqual(expect.arrayContaining(["react", "preact", "solid-js"]))
  })

  it("finds the multi-line schema import this tree actually uses", () => {
    expect(importsOf(join(renderDir, "view-model.ts"))).toContain("../../schema/index.js")
  })
})

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
/**
 * Every run of digits that appears in a rendered body but in none of the
 * source's own wording.
 *
 * The first version of these tests named the coercions it expected — "1.5",
 * "90 min", "8 h" — which is a guess about the FORM a fabricated number would
 * take, and a differently formatted one passes all of them. This asks the
 * question the criterion actually asks: is every number on the page a number
 * the source wrote? It needs no guess, and it fails on a coercion in any
 * format.
 */
const stringsIn = (value: unknown): string[] => {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(stringsIn)
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(stringsIn)
  return []
}

const unsourcedNumbers = (body: string, recipe: CanonicalRecipe): string[] => {
  const wording = stringsIn(recipe).join("\u0000")
  return [...body.matchAll(/\d+/g)].map((m) => m[0]).filter((digits) => !wording.includes(digits))
}

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
    // 1.5 is the midpoint of 1–2 and 11 the midpoint of 10–12. Rather than
    // name those two guesses, require that EVERY number on the page is one the
    // source wrote — which catches a midpoint in any format, and a coercion
    // nobody thought of.
    expect(unsourcedNumbers(body, onions)).toEqual([])
  })

  it("a range duration keeps its wording, in the step and in the listing", () => {
    expect(renderRecipePage(onions)).toContain("10–12 Min.")
    expect(renderLibraryPage([onions])).toContain("1–2 Std.")
    expect(unsourcedNumbers(libraryBody([toLibraryCardView(onions)]).toString(), onions)).toEqual(
      [],
    )
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

  it("an open-ended duration stays open-ended and gains no endpoint", () => {
    const body = recipeBody(toRecipeView(onions)).toString()
    expect(body).toContain("über Nacht")
    // "overnight" has no number, so any duration-shaped number standing in for
    // it would be unsourced — whether it were rendered as 8 h, 480 min or
    // anything else.
    expect(unsourcedNumbers(body, onions)).toEqual([])
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
    const hostileSrc = '" onerror="alert(1)'
    // Both pages, not just the recipe page: the listing renders an image and a
    // link of its own, and an escaping gap in one says nothing about the other.
    for (const output of [
      renderRecipePage(onions, { mediaSrc: () => hostileSrc }),
      renderLibraryPage([onions], { mediaSrc: () => hostileSrc, href: () => hostileSrc }),
    ]) {
      expect(output).not.toMatch(/\son[a-z]+\s*=\s*["']/i)
      expect(output).not.toContain('onerror="')
      expect(output).toContain("&quot; onerror=&quot;alert(1)")
    }
  })

  it("a page whose body turned out to be async throws rather than shipping a stub", () => {
    // `.toString()` on a promise yields "[object Promise]", which would replace
    // the whole body with two words and raise nothing. Rendering is synchronous
    // by construction, so the async case is a bug and must say so.
    expect(() => page("Async", Promise.resolve(recipeBody(toRecipeView(onions))))).toThrow(
      /synchronous by construction/,
    )
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
