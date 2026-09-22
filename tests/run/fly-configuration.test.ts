/**
 * The platform file's three claims (ADR-0026's fourth portability cut).
 *
 * `fly.toml` is the one file in this repository that knows which platform the
 * instance runs on. Nothing executes it here and nothing can: what a platform
 * does with a configuration file is that platform's behaviour, not this
 * repository's. So these are readings of text, and each case says what it buys
 * and what it does not rather than reading like a behavioural proof.
 *
 * What makes them worth writing anyway is that all three failures they guard
 * are SILENT. A machine built from the wrong Dockerfile boots, runs the test
 * suite and reports itself healthy. A machine whose routed port does not match
 * its bound port passes every health check the platform makes against the
 * machine and answers nothing. A secret pasted into `[env]` works perfectly and
 * is committed to a public repository. None of the three produces an error
 * anyone would see.
 *
 * Each `describe` string is the proof id it satisfies.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8")

/** The real file every case below is ultimately asked about. */
const FLY_TOML = read("fly.toml")

/**
 * The body of one top-level table, with comments stripped, or `undefined` when
 * the file declares no such table.
 *
 * ## Why this is not a TOML parser
 *
 * It reads three keys out of three named tables and nothing else. A real parser
 * is a dependency this repository does not have — `package.json` declares five
 * — and hand-writing one would be a second parser to keep correct, which is the
 * trade `run/the-seam-detector-is-precise` already refused once.
 *
 * It is crude in ONE direction on purpose. A table ends at the next line that
 * starts a table, so a key indented under `[build]` belongs to `[build]` and a
 * key sitting after `[env]` does not — which is exactly the mistake a
 * section-blind `grep` makes and the reason `MUST_FLAG` below contains a file
 * whose `dockerfile` key is in the wrong table. Comments are stripped before
 * any key is read, so a line of prose ABOUT a key can never be mistaken for the
 * key; `MUST_SPARE` contains that case, because a guard that fires on a comment
 * is a guard that gets loosened the first time it is inconvenient.
 */
function tableBody(toml: string, table: string): string | undefined {
  const lines = toml.split("\n").map((line) => line.replace(/(^|\s)#.*$/, ""))
  const opens = (line: string): boolean => /^\s*\[\[?[^\]]+\]\]?\s*$/.test(line)
  const start = lines.findIndex((line) => new RegExp(`^\\s*\\[\\[?${table}\\]\\]?\\s*$`).test(line))
  if (start === -1) return undefined
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(opens)
  return (end === -1 ? rest : rest.slice(0, end)).join("\n")
}

/** A quoted or bare value for `key` inside `table`, or `undefined`. */
function valueIn(toml: string, table: string, key: string): string | undefined {
  const body = tableBody(toml, table)
  if (body === undefined) return undefined
  const match = new RegExp(`^\\s*${key}\\s*=\\s*(?:"([^"]*)"|(\\S+))\\s*$`, "m").exec(body)
  if (match === null) return undefined
  return match[1] ?? match[2]
}

/** The Dockerfile the platform is told to build, as this repository declares it. */
const declaredDockerfile = (toml: string): string | undefined =>
  valueIn(toml, "build", "dockerfile")

describe("run/the-platform-file-builds-the-runtime-image", () => {
  it("the platform is told to build Dockerfile.runtime, by name", () => {
    // The failure this guards, in full: this repository carries two Dockerfiles
    // on purpose (`run/the-runtime-image-runs-the-process` is why). `Dockerfile`
    // is the CI container and its `CMD` is `npm run quality`. A platform that
    // scans a repository for something to build takes `Dockerfile` — so an
    // omitted key here, not a wrong one, is the likely mistake, and it deploys a
    // machine that runs the test suite at boot and serves nothing.
    //
    // Measured before this file existed: the platform's own repository scan
    // proposed exactly that.
    expect(declaredDockerfile(FLY_TOML)).toBe("Dockerfile.runtime")
  })

  it("and that file is really in the repository, so the name points at something", () => {
    // Without this case the rule above is satisfied by a file that names an
    // image nobody can build. The deploy would fail rather than mislead, which
    // is the better failure — but a green test beside a deploy that cannot run
    // is worse than either.
    expect(() => read("Dockerfile.runtime")).not.toThrow()
  })
})

/**
 * Platform files this guard MUST reject, and the near neighbours it MUST spare.
 *
 * ## Why this table exists
 *
 * The case above pins the guard's AIM: the declared Dockerfile must be
 * `Dockerfile.runtime`. It pins nothing about its BREADTH. A reader who
 * narrowed `declaredDockerfile` to a bare `/dockerfile\s*=\s*"(.+)"/` over the
 * whole file would keep that case green while accepting a `dockerfile` key
 * declared in the wrong table — which the platform does not read, so the build
 * falls back to `Dockerfile` and the machine runs the test suite again. The
 * widening would be invisible.
 *
 * So the shapes are fixtures, and they run through the same `declaredDockerfile`
 * the case above runs, so the two cannot drift apart.
 *
 * ## The spare list is the half that can be wrong
 *
 * A guard that rejected every file would satisfy every `MUST_FLAG` entry and be
 * worthless. `MUST_SPARE` is what stops that, and it is worth something only
 * where each entry sits CLOSE to a rejected one. A file with no `[build]` table
 * at all is rejected by any guard ever written. A file whose COMMENT says
 * `dockerfile = "Dockerfile"` while its key says otherwise is one `#` away from
 * a real violation, and a file that declares `[build]` after `[env]` is the same
 * file with its tables in a different order.
 */
const MUST_FLAG: readonly { readonly name: string; readonly toml: string }[] = [
  {
    name: "no build table at all — the platform scans and takes Dockerfile",
    toml: 'app = "cookframe"\n\n[env]\n  PORT = "8080"\n',
  },
  {
    name: "a build table with no dockerfile key — same fallback, harder to see",
    toml: 'app = "cookframe"\n\n[build]\n\n[env]\n  PORT = "8080"\n',
  },
  {
    name: "the CI image named outright",
    toml: '[build]\n  dockerfile = "Dockerfile"\n',
  },
  {
    name: "the CI image behind a path prefix",
    toml: '[build]\n  dockerfile = "./Dockerfile"\n',
  },
  {
    // The entry a section-blind pattern spares. The platform reads no
    // `dockerfile` key here, so it builds `Dockerfile`.
    name: "the right value in the wrong table",
    toml: '[env]\n  dockerfile = "Dockerfile.runtime"\n',
  },
  {
    // One `#` away from correct. The key the platform reads is commented out,
    // so this is the no-key case wearing the right words.
    name: "the key commented out, the value still readable",
    toml: '[build]\n  # dockerfile = "Dockerfile.runtime"\n',
  },
]

const MUST_SPARE: readonly { readonly name: string; readonly toml: string }[] = [
  {
    name: "the shape this repository ships",
    toml: '[build]\n  dockerfile = "Dockerfile.runtime"\n',
  },
  {
    // A guard that searched the file for the word `Dockerfile` would reject
    // this, and the comment is the reason the key is right.
    name: "a comment warning against Dockerfile, above the correct key",
    toml: '[build]\n  # never point this at Dockerfile: its CMD is the test suite\n  dockerfile = "Dockerfile.runtime"\n',
  },
  {
    // Table order is not meaning. A guard that read the first table only, or
    // stopped at the first key it found, would reject this.
    name: "the build table after the env table",
    toml: '[env]\n  PORT = "8080"\n\n[build]\n  dockerfile = "Dockerfile.runtime"\n',
  },
  {
    // The entry that makes `tableBody`'s comment stripping do work. A trailing
    // comment is ordinary TOML, and without the strip the value pattern's
    // end-of-line anchor stops matching, so this correct file is rejected.
    //
    // Found by mutation: removing the strip left every other case in this file
    // green, so the line that justifies it was guarded by nothing.
    name: "a trailing comment after the value",
    toml: '[build]\n  dockerfile = "Dockerfile.runtime" # not Dockerfile: that one runs the gate\n',
  },
]

describe("run/the-dockerfile-reader-is-precise", () => {
  it.each(MUST_FLAG)("rejects: $name", ({ toml }) => {
    expect(declaredDockerfile(toml)).not.toBe("Dockerfile.runtime")
  })

  it.each(MUST_SPARE)("spares: $name", ({ toml }) => {
    expect(declaredDockerfile(toml)).toBe("Dockerfile.runtime")
  })
})

describe("run/the-platform-file-routes-to-the-bound-port", () => {
  it("the port the process is told to bind is the port the platform routes to", () => {
    // `PORT` has no default in the code (`src/server/config.ts`), so the value
    // in `[env]` is the whole instruction: the process binds that and nothing
    // else. `internal_port` is where the platform sends traffic on the machine.
    //
    // When they disagree the machine starts, the process serves correctly on its
    // own port, and every request arrives at a port nothing is listening on. The
    // machine is healthy by every measure the platform has and answers nothing —
    // which is why this is a test and not a comment.
    const bound = valueIn(FLY_TOML, "env", "PORT")
    const routed = valueIn(FLY_TOML, "http_service", "internal_port")

    expect(bound, "fly.toml [env] declares no PORT").toBeDefined()
    expect(routed, "fly.toml [http_service] declares no internal_port").toBeDefined()
    expect(routed).toBe(bound)
  })

  it("and the runtime image exposes that same port", () => {
    // Third reading of the same number, and the one that ties the platform file
    // to the image it builds. `EXPOSE` documents rather than binds, so this
    // cannot prove the socket is open — it proves the three declarations have
    // not drifted apart, which is the failure that is silent.
    const exposed = /^EXPOSE\s+(\d+)\s*$/m.exec(read("Dockerfile.runtime"))
    expect(exposed, "Dockerfile.runtime declares no EXPOSE").not.toBeNull()
    expect((exposed as RegExpExecArray)[1]).toBe(valueIn(FLY_TOML, "env", "PORT"))
  })
})

/**
 * The four values that must never be written into `fly.toml`.
 *
 * Read off `.env.example`'s own reasons rather than restated: `DATABASE_URL`
 * carries the database password, `OPENAI_API_KEY` is PDR-0001 invariant 8, and
 * the two Cookframe credentials are PDR-0003's. `fly.toml` is plain text in a
 * PUBLIC repository, and the platform offers a plain environment field beside
 * its encrypted secret store, so writing one here is one careless paste away at
 * any time.
 */
const SECRET_NAMES: readonly string[] = [
  "DATABASE_URL",
  "OPENAI_API_KEY",
  "COOKFRAME_INGEST_CREDENTIAL",
  "COOKFRAME_LIBRARY_CREDENTIAL",
]

/** The names `[env]` actually assigns, comments stripped. */
function envKeys(toml: string): string[] {
  const body = tableBody(toml, "env") ?? ""
  return [...body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((m) => m[1] as string)
}

/** Every variable the process refuses to start without, `DATABASE_URL` included. */
function requiredVariables(): string[] {
  const declared = /REQUIRED_CONFIGURATION[^=]*=\s*\[([^\]]*)\]/s.exec(
    read(join("src", "server", "config.ts")),
  )?.[1]
  const names = (declared?.match(/"([^"]+)"/g) ?? []).map((quoted) => quoted.slice(1, -1))
  // `DATABASE_URL` is required and deliberately absent from that list — the
  // store's own seam refuses it (`src/server/main.ts` says why) — so it is added
  // here rather than inferred from a list that cannot carry it.
  return [...names, "DATABASE_URL"]
}

describe("run/the-platform-file-carries-no-secret", () => {
  it("the secret list is exactly the required variables this file does not set", () => {
    // The list above is a fixture, and a fixture can be narrowed. Cutting it to
    // `["OPENAI_API_KEY"]` leaves `it.each` below running one case instead of
    // four — quieter coverage, not a failure — so without this case the guard's
    // BREADTH would be held by nothing that executes.
    //
    // Derived rather than restated: whatever the process requires and this file
    // does not assign must be a secret, and nothing else may be on the list.
    const set = envKeys(FLY_TOML)
    expect([...SECRET_NAMES].sort()).toEqual(
      requiredVariables()
        .filter((n) => !set.includes(n))
        .sort(),
    )
  })

  it("no secret is assigned in the plain environment table", () => {
    expect(envKeys(FLY_TOML).filter((key) => SECRET_NAMES.includes(key))).toEqual([])
  })

  it("and the table does assign something, so the rule guards a populated file", () => {
    // Without this case the rule above passes on a file with no `[env]` table,
    // which is the state a guard against "is anything secret in here" reaches by
    // deleting the thing it guards.
    expect(envKeys(FLY_TOML).length).toBeGreaterThan(0)
  })

  it.each(SECRET_NAMES)("rejects %s pasted into the environment table", (secret) => {
    // Each secret planted individually. A guard that knew only `OPENAI_API_KEY`
    // would pass the case above on this repository's file forever.
    const planted = `[env]\n  PORT = "8080"\n  ${secret} = "a-real-looking-value"\n`
    expect(envKeys(planted).filter((key) => SECRET_NAMES.includes(key))).toEqual([secret])
  })

  it("spares the non-secret names that sit closest to them", () => {
    // `OPENAI_MODEL` is one word from `OPENAI_API_KEY`, and a guard matching
    // `/OPENAI/` or `/COOKFRAME/` would reject the configuration this file
    // exists to carry. This is the case that stops the rule above from being
    // satisfied by rejecting everything.
    const spared =
      '[env]\n  PORT = "8080"\n  MODEL_PROVIDER = "openai"\n  OPENAI_MODEL = "gpt-5.4"\n'
    expect(envKeys(spared).filter((key) => SECRET_NAMES.includes(key))).toEqual([])
    expect(envKeys(spared)).toContain("OPENAI_MODEL")
  })

  it("and every name the process requires is either set here or named as a secret", () => {
    // The inventory, so a variable added to `REQUIRED_CONFIGURATION` later
    // cannot quietly be neither — a machine that exits on its first start
    // naming a variable nobody knew to set.
    //
    // `FLY_TOML.includes(name)` is the weaker half and says so: it asks only
    // that this file MENTION the secret, which it does in `[env]`'s comment
    // listing the four values that are set with the platform's secret store.
    // A mention is not a setting, and nothing here can check the platform's
    // secret store from a test.
    const required = requiredVariables()
    expect(required.length).toBeGreaterThan(1)

    const set = envKeys(FLY_TOML)
    const unaccounted = required.filter(
      (name) => !set.includes(name) && !(SECRET_NAMES.includes(name) && FLY_TOML.includes(name)),
    )
    expect(unaccounted).toEqual([])
  })
})
