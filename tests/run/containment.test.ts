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

  it("the runtime image's command is the declared start command", () => {
    // Read off `package.json`, not restated: renaming the start script and
    // leaving the image behind is exactly the drift this checks.
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> })
      .scripts
    expect(scripts["start"]).toBeTruthy()
    expect(commandOf(runtime)).toContain("start")
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
