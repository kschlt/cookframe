/**
 * CFV1-RUN — the two structural criteria: what may bind, and which image runs.
 *
 * Both are read off the repository rather than exercised, and both say exactly
 * what that buys and what it does not. A file scan cannot prove an image boots;
 * it can prove the two images have not quietly become one, which is the failure
 * that actually happened to this project's container once before (see the `lint`
 * job's comment in the CI workflow).
 *
 * Each `describe` string is the proof id it satisfies.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** Every `.ts`/`.mts` file under a directory, repo-relative, sorted. */
function sourcesUnder(dir: string): string[] {
  const found: string[] = []
  const walk = (absolute: string): void => {
    for (const entry of readdirSync(absolute)) {
      const child = join(absolute, entry)
      if (statSync(child).isDirectory()) {
        walk(child)
      } else if (/\.m?ts$/.test(entry)) {
        found.push(relative(repoRoot, child))
      }
    }
  }
  walk(join(repoRoot, dir))
  return found.sort()
}

const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8")

describe("run/only-the-entry-point-binds", () => {
  it("nothing outside the entry point names the adapter, a socket or a node HTTP type", () => {
    // ADR-0007's containment, made checkable. The record says the adapter is "an
    // implementation detail of the entry point"; the day a second module imports
    // it, moving this instance to another runtime stops being a change to one
    // file, and nothing would report that — every test would still pass.
    //
    // Anchored on what the code DOES, not on the words it contains: two modules
    // here explain the adapter's content-length defect in prose, and a bare
    // substring match reported them as offenders. A check that fires on a
    // comment is a check that gets loosened the first time it is inconvenient.
    const moduleSpecifier =
      /(?:from|import)\s*\(?\s*["'](@hono\/node-server|node:https?|node:http2|node:net|node:tls)["']/
    const forbidden = [moduleSpecifier, /\bcreateServer\s*\(/, /\.listen\s*\(/]

    const offenders: string[] = []
    for (const file of [...sourcesUnder("src"), ...sourcesUnder("schema")]) {
      // The entry point is the one place allowed to, and it is named here as a
      // path rather than "anything under src/server", so a second file added
      // beside it is still caught.
      if (file === join("src", "server", "instance.ts")) continue
      const text = read(file)
      for (const pattern of forbidden) {
        if (pattern.test(text)) offenders.push(`${file} matches ${pattern}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("and the entry point IS the file that binds, so the rule guards something", () => {
    // Without this case the rule above passes trivially the day the adapter is
    // dropped and nothing binds at all — which is the state this unit found the
    // repository in.
    const entry = read(join("src", "server", "instance.ts"))
    expect(entry).toMatch(/@hono\/node-server/)
    expect(entry).toMatch(/\bserve\(/)

    // And `main.ts` does NOT bind: it reads configuration and composes. The
    // split is what lets every other proof in this folder start a real server
    // without an API key.
    expect(read(join("src", "server", "main.ts"))).not.toMatch(/@hono\/node-server/)
  })

  it("the composition root hands the store's own close to the instance", () => {
    // A TEXT assertion, and it says so rather than reading like a behavioural
    // one. `run/a-stop-leaves-nothing-half-written` proves the ORDER — the
    // server drains before `closeStore` runs — but it does so against the test
    // harness's counter, because nothing outside the process can observe
    // `main.ts`'s own wiring: the stop handler calls `process.exit(0)`, so a
    // pool that was never drained and one that was look identical from a socket,
    // an exit code and a log line.
    //
    // So what this guards is exactly that the hook is connected to the real
    // store, and it does not guard that the pool is drained. That distinction is
    // the defect this repository keeps finding, and writing it down is cheaper
    // than finding it again.
    const entry = read(join("src", "server", "main.ts"))
    expect(entry).toMatch(/closeStore:\s*\(\)\s*=>\s*store\.close\(\)/)
  })

  it("the adapter is a declared dependency, not a transitive accident", () => {
    const manifest = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>
    }
    expect(manifest.dependencies?.["@hono/node-server"]).toBeTruthy()
  })
})

describe("run/the-runtime-image-runs-the-process", () => {
  const ci = read("Dockerfile")
  const runtime = read("Dockerfile.runtime")

  /** The `CMD` line's contents, as a single string. */
  const commandOf = (dockerfile: string): string => {
    const match = /^CMD\s+(.+)$/m.exec(dockerfile)
    if (match === null) throw new Error("that Dockerfile declares no CMD")
    return match[1] as string
  }

  it("the runtime image's command is the declared start command, token for token", () => {
    // Read off `package.json`, not restated: renaming the start script and
    // leaving the image behind is exactly the drift this checks.
    //
    // Compared as ARGV rather than as a substring, because `CMD ["npm",
    // "start"]` contains the word "start" and is the version that FAILED in CI.
    // It answered every request correctly and then could not shut down:
    // `docker stop` signals PID 1, PID 1 was npm, and the process holding the
    // shutdown handler never saw SIGTERM. The image has to run the same program
    // the declared command runs, not a wrapper that happens to invoke it.
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> })
      .scripts
    const declared = scripts["start"]
    expect(declared, "package.json declares no start script").toBeTruthy()

    const cmdArgv = JSON.parse(commandOf(runtime)) as string[]
    expect(cmdArgv).toEqual((declared as string).split(/\s+/))
    expect(cmdArgv[0]).not.toBe("npm")
    expect(commandOf(runtime)).not.toContain("quality")
  })

  it("it is NOT the image whose command is the quality gate", () => {
    // The two images have different jobs. Handing the CI image a different
    // command at `docker run` would have "worked" and is how an image whose
    // default command is a test suite ends up in front of a user's library.
    expect(commandOf(ci)).toContain("quality")
    expect(commandOf(ci)).not.toEqual(commandOf(runtime))
  })

  it("CI builds and runs the runtime image, so this file scan is not the whole proof", () => {
    // Stated plainly: everything above is a reading of text and cannot show that
    // an image boots. What shows that is the `container` job, which builds
    // `Dockerfile.runtime` and starts the process inside it against a real port.
    // This case exists so that deleting that step is a failing test rather than
    // a quiet loss of the only executable half.
    const workflow = read(join(".github", "workflows", "ci.yml"))
    expect(workflow).toContain("Dockerfile.runtime")
  })
})

/**
 * Every way a line can get at the process environment.
 *
 * `process.env` was the whole pattern once, and a review planted the hole:
 * `const env = process["env"]` in an undeclared module read the real
 * environment and this check stayed green. Property access has two spellings
 * in JavaScript and a guard that knows only one is a guard against typing
 * style. The third alternative catches the alias — `const { env } = process`,
 * or `const p = process` — by matching an assignment of `process` ITSELF, with
 * nothing following it, since every read through the alias happens on some
 * later line this pattern would never see.
 */
const ENVIRONMENT_READ =
  /process\s*\.\s*env\b|process\s*\[\s*(?:"env"|'env'|`env`)\s*\]|=\s*process\b(?![.[])/

/**
 * A line that reads the environment, ignoring the ones that only talk about it.
 *
 * Crude on purpose: a line whose first non-space characters are `//` or `*` is
 * prose, and most mentions of `process.env` under `src/` are exactly that —
 * comments explaining why the seam below them takes a parameter. A stripper
 * that understood TypeScript would be a second parser to keep correct; this one
 * is wrong only in ways that make the check STRICTER (a real read hidden at the
 * end of a comment line would still be reported).
 */
const readsTheEnvironment = (text: string): boolean =>
  text.split("\n").some((line) => ENVIRONMENT_READ.test(line) && !/^\s*(?:\/\/|\*|\/\*)/.test(line))

describe("run/configuration-arrives-only-through-declared-seams", () => {
  // ADR-0026's cut, declared as an inventory rather than described in prose,
  // because a record that lists the seams goes stale the first time someone
  // adds one and the build says nothing.
  //
  // The shape each seam must keep: the environment arrives as a PARAMETER —
  // defaulted from `process.env` at one point in the signature, or supplied by
  // the composition root at the call site. Never a read inside a function body,
  // never a module-level constant. That is what lets every proof in this
  // repository build an environment from nothing instead of mutating the one it
  // runs in.
  const SEAMS: readonly { readonly file: string; readonly shape: RegExp }[] = [
    // Defaulted parameter: every caller may inject, and the default is the
    // process's own environment.
    {
      file: "src/cooking/policy.ts",
      shape: /env: Readonly<Record<string, string \| undefined>> = process\.env,/,
    },
    {
      file: "src/persistence/configuration.ts",
      shape:
        /export function resolveDatabaseUrl\(\s*env: Record<string, string \| undefined> = process\.env,?\s*\)/,
    },
    // The strictest of the three, and the shape the others should move toward:
    // `readConfiguration` takes the environment as a REQUIRED parameter and
    // names no default, so the composition root is the only place the real one
    // enters the program.
    { file: "src/server/main.ts", shape: /readConfiguration\(process\.env\)/ },
  ]

  it("no module under src/ reads the environment except the declared seams", () => {
    const readers = sourcesUnder("src").filter((file) => readsTheEnvironment(read(file)))
    expect(readers).toEqual(SEAMS.map((s) => s.file))
  })

  it("each declared seam still has the shape it was declared with", () => {
    // Listing a file is not enough: a seam that keeps its name and moves the
    // read into its body is exactly the drift the inventory exists to catch,
    // and it would pass the test above unchanged.
    for (const seam of SEAMS) {
      expect(read(seam.file), `${seam.file} no longer matches its declared seam shape`).toMatch(
        seam.shape,
      )
    }
  })
})

describe("run/no-module-names-a-platform", () => {
  /** The package specifier of an import line, or undefined. */
  const importedPackage = (line: string): string | undefined => {
    const found = /^\s*(?:import\b.*|export\b.*|\})\s*from "([^"]+)"/.exec(line)
    const specifier = found?.[1]
    if (specifier === undefined) return undefined
    if (specifier.startsWith(".") || specifier.startsWith("node:")) return undefined
    // `hono/html` and `hono` are one dependency; a scoped name keeps two parts.
    const parts = specifier.split("/")
    return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
  }

  it("the third-party packages src/ imports are exactly the declared five", () => {
    // An ALLOWLIST, which is the whole point. A deny list of platform SDKs is a
    // list of the ones someone thought of; this fails on the first arrival of
    // anything — a platform client, a second database driver, an HTTP-over-
    // `fetch` transport that speaks to one provider's database and nobody
    // else's. ADR-0026's portability rests on that being a build failure rather
    // than a review catch.
    const packages = new Set<string>()
    for (const file of sourcesUnder("src")) {
      for (const line of read(file).split("\n")) {
        const name = importedPackage(line)
        if (name !== undefined) packages.add(name)
      }
    }
    expect([...packages].sort()).toEqual(["@hono/node-server", "hono", "ipaddr.js", "pg", "undici"])
  })

  it("no module names a hosting platform", () => {
    // A deny list here, and it is sound where the one above would not be: this
    // catches a platform NAMED without a package — an environment variable only
    // one host sets, a hostname only one host serves. The allowlist above is
    // what catches a platform's SDK, so the two together do not rest on anyone
    // having thought of every provider.
    const platformish =
      /\b(?:FLY_[A-Z_]+|RENDER_[A-Z_]+|VERCEL_[A-Z_]+|RAILWAY_[A-Z_]+|DYNO|HEROKU_[A-Z_]+)\b|\.fly\.dev|fly\.io|\.onrender\.com|\.vercel\.app/
    const naming = sourcesUnder("src").filter((file) => platformish.test(read(file)))
    expect(naming).toEqual([])
  })
})
