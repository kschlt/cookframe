/**
 * CFV1-RUN — the PROCESS, started the way an operator starts it.
 *
 * Everything else in this folder calls `startInstance` from inside the test
 * runner. That proves the composition and the socket; it does not prove that the
 * command a person types brings the thing up. The two are different claims, and
 * the second one is the unit's first acceptance criterion — for nineteen pull
 * requests the code was correct and there was no way to run it.
 *
 * So this suite spawns the DECLARED command, read off `package.json` rather than
 * restated here, waits for the line the process prints when its port is bound,
 * talks to it over TCP, and signals it. Nothing is stubbed, and the environment
 * handed to the child is built from nothing — this process's own variables are
 * not inherited, so a real `OPENAI_API_KEY` in the session cannot make a proof
 * pass that would fail on a clean machine.
 *
 * **Since CFV1-PG the composition root builds a PostgreSQL store, so the serving
 * case needs a real database.** It does not get its own rule for that: it uses
 * `decideDatabaseAvailability` from the persistence harness, the same pure
 * function `tests/persistence/` is governed by — no database asked for is a
 * skip, a database asked for and unreachable is a failure. Reimplementing that
 * choice here is how the two would drift, and the half that drifts is always the
 * one that stops failing. `tests/unit/repo-config.test.ts` requires the `run` CI
 * job to set `DATABASE_URL` against a service, which is what stops "skipped
 * everywhere" from being a green build.
 *
 * The schema is provisioned per run and dropped after, so this suite reads no
 * leftover from another and leaves none.
 */
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { createServer } from "node:net"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"
import { afterAll, describe, expect, it } from "vitest"
import { NOT_FOUND_BODY, NOT_FOUND_STATUS } from "../../src/http/not-found.js"
import { createPostgresStore } from "../../src/persistence/index.js"
import {
  decideDatabaseAvailability,
  isReachable,
  type ProvisionedSchema,
  provisionSchema,
  urlForSchema,
} from "../persistence/postgres-harness.js"
import { canonical, INGEST_CREDENTIAL, LIBRARY_CREDENTIAL } from "./harness.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** The declared start command, read from the manifest rather than written here. */
function declaredStartCommand(): string {
  const scripts = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).scripts as
    | Record<string, string>
    | undefined
  const start = scripts?.["start"]
  if (start === undefined) {
    throw new Error("package.json declares no `start` script, so there is no way to run this")
  }
  return start
}

/**
 * A port nobody is on, found by binding one and letting go.
 *
 * `PORT=0` would be simpler and is deliberately refused by the configuration: an
 * operator who sets it gets an instance on a port they cannot predict, which is
 * indistinguishable from one that did not start. The proof carries the cost of
 * that strictness rather than loosening the rule to suit itself.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      if (address === null || typeof address === "string") {
        probe.close()
        reject(new Error("could not obtain a free port"))
        return
      }
      const { port } = address
      probe.close(() => resolve(port))
    })
  })
}

/**
 * The configuration a started instance needs, and nothing else.
 *
 * `databaseUrl` is separate because two cases here deliberately leave it out:
 * the refusal cases, which must reach a non-zero exit without a server anywhere
 * near them.
 */
function environment(port: number, databaseUrl?: string): Record<string, string> {
  return {
    // `npm` and `node` need these to exist at all; nothing else is inherited.
    PATH: process.env["PATH"] ?? "",
    HOME: process.env["HOME"] ?? "",
    PORT: String(port),
    MODEL_PROVIDER: "openai",
    // Never used: no test here submits a capture, so no model call is made.
    // A real key would be a real charge, and this proof has no business making
    // one (the project's budget rule).
    OPENAI_API_KEY: "not-a-real-key",
    OPENAI_MODEL: "not-a-real-model",
    COOKFRAME_INGEST_CREDENTIAL: INGEST_CREDENTIAL,
    COOKFRAME_LIBRARY_CREDENTIAL: LIBRARY_CREDENTIAL,
    ...(databaseUrl === undefined ? {} : { DATABASE_URL: databaseUrl }),
  }
}

interface Started {
  readonly child: ReturnType<typeof spawn>
  readonly output: () => string
  readonly exited: Promise<number | null>
}

/**
 * Spawn the declared start command with a built environment, capturing
 * everything it says.
 *
 * The command is SPLIT and run directly rather than through `npm start`, and
 * that is not a shortcut — it is what makes the signal case meaningful. `npm
 * start` puts npm and a shell between the signal and the process: SIGTERM then
 * kills npm, npm's own exit is "terminated by signal", and the proof would be
 * measuring npm's signal handling while the instance's shutdown never ran. The
 * command itself still comes from `package.json`, so a changed command is a
 * changed proof.
 */
function spawnInstance(env: Record<string, string>): Started {
  const [bin, ...args] = declaredStartCommand().split(/\s+/)
  if (bin === undefined) throw new Error("the declared start command is empty")
  const child = spawn(bin, args, {
    cwd: repoRoot,
    // The project's own binaries, the way an npm script sees them.
    env: { ...env, PATH: `${join(repoRoot, "node_modules", ".bin")}:${env["PATH"] ?? ""}` },
  })
  let output = ""
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString()
  })
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString()
  })
  const exited = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(code))
  })
  return { child, output: () => output, exited }
}

/** Wait until `match` appears in the child's output, or give up loudly. */
async function waitFor(started: Started, match: RegExp, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = match.exec(started.output())
    if (found !== null) return found[0]
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(
    `the process never printed ${match}. What it did say:\n${started.output() || "(nothing)"}`,
  )
}

/**
 * Whether a database was asked for, decided by the persistence harness's rule
 * rather than by one of this file's own.
 *
 * Resolved at module load because the decision governs whether the suite below
 * exists at all. A skip here is honest only because CI sets `DATABASE_URL` for
 * the `run` job; see this file's header.
 */
const availability = await (async () => {
  const configured = process.env["DATABASE_URL"]
  const reachable =
    configured === undefined || configured.trim() === "" ? false : await isReachable(configured)
  return decideDatabaseAvailability(configured, reachable)
})()

if (availability.mode === "fail") throw new Error(availability.reason)

/**
 * Every schema this file provisions, dropped at the end.
 *
 * A list rather than one, because each suite below that needs a database needs
 * its OWN: a library left behind by one proof is a library the next one would
 * read, and a proof that passes on another proof's leftovers is not measuring
 * what its name says.
 */
const provisioned: ProvisionedSchema[] = []

async function ownSchema(): Promise<ProvisionedSchema> {
  if (availability.mode !== "run") throw new Error("unreachable: the suite is skipped")
  const schema = await provisionSchema(availability.url)
  provisioned.push(schema)
  return schema
}

afterAll(async () => {
  for (const schema of provisioned) await schema.drop()
})

/**
 * The library page as an operator's client reads it: over TCP, with the library
 * credential, and only when the instance actually answers 200.
 */
async function library(port: number): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    headers: { authorization: `Bearer ${LIBRARY_CREDENTIAL}` },
  })
  expect(res.status).toBe(200)
  return await res.text()
}

describe.skipIf(availability.mode === "skip")("run/the-process-serves-and-stops", () => {
  it("starts from the declared command, answers on a real socket, and stops cleanly", async () => {
    // Read, not asserted against a literal: if the declared command changes,
    // this proof runs the new one. What it will not tolerate is a command that
    // does not serve.
    expect(declaredStartCommand()).toBeTruthy()

    // An empty, migrated schema of this run's own. The store the process builds
    // is constructed from this URL and nothing else, exactly as an operator's
    // is — the isolation lives in the connection string, not in a test seam.
    const schema = await ownSchema()

    const port = await freePort()
    const started = spawnInstance(environment(port, schema.url))

    try {
      // The process announces its bound port on one line, which is what makes
      // this proof a wait rather than a poll-until-it-answers loop — the
      // difference between a test and a flaky test.
      await waitFor(started, /cookframe listening on port \d+/)

      // A real request over TCP to a separate operating-system process. No
      // credential, so the answer is the shared miss; that it IS that answer,
      // byte for byte, is what says the composed surface came up rather than
      // some fragment of it.
      const res = await fetch(`http://127.0.0.1:${port}/`)
      expect(res.status).toBe(NOT_FOUND_STATUS)
      expect(await res.text()).toBe(NOT_FOUND_BODY)

      // The credentialed library answers from the same process, so this is not
      // a 404 from something that failed to mount the routes.
      const admitted = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { authorization: `Bearer ${LIBRARY_CREDENTIAL}` },
      })
      expect(admitted.status).toBe(200)
      expect(await admitted.text()).toContain("No recipes saved yet.")

      // SIGTERM is what a container runtime sends when it stops a container,
      // and the operating model this instance must tolerate is being stopped
      // as soon as it is idle. A process that ignores it is one the platform
      // eventually kills instead.
      started.child.kill("SIGTERM")
      const code = await Promise.race([
        started.exited,
        new Promise<"timed out">((resolve) => setTimeout(() => resolve("timed out"), 15_000)),
      ])
      expect(code, `it did not exit on SIGTERM. Output:\n${started.output()}`).toBe(0)
      // It stopped because it decided to, not because it was cut down: the
      // shutdown path ran and said so.
      expect(started.output()).toContain("cookframe stopping on SIGTERM")

      // And it is really gone from the port, not merely no longer printing.
      await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow()
    } finally {
      started.child.kill("SIGKILL")
    }
  }, 60_000)
})

describe("run/absent-configuration-refuses-by-name", () => {
  it("refuses to start when a required value is absent, and says which", async () => {
    // The process-level half of this criterion. `configuration.test.ts` proves
    // the rule over every combination without paying for a process; this case
    // proves the process actually obeys it — that the refusal reaches an
    // operator's terminal and costs a non-zero exit, rather than being a throw
    // someone catches on the way to a default.
    const port = await freePort()
    const env = environment(port)
    delete env["COOKFRAME_LIBRARY_CREDENTIAL"]

    const started = spawnInstance(env)
    try {
      const code = await Promise.race([
        started.exited,
        new Promise<"timed out">((resolve) => setTimeout(() => resolve("timed out"), 30_000)),
      ])
      expect(code, `Output:\n${started.output()}`).not.toBe(0)
      expect(started.output()).toContain("COOKFRAME_LIBRARY_CREDENTIAL")
      // Nothing bound, so the absent value was not defaulted into an instance
      // that appears to work.
      await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow()
    } finally {
      started.child.kill("SIGKILL")
    }
  }, 60_000)

  it("refuses to start when DATABASE_URL is absent, and says so", async () => {
    // `DATABASE_URL` is the one required value `readConfiguration` does not
    // list, because the store's own seam refuses it (`resolveDatabaseUrl`). That
    // split is a reasonable design and an easy place for the rule to go missing
    // altogether — nothing in `configuration.test.ts` covers this variable, and
    // nothing in `tests/persistence/` starts a process. This case is where the
    // two halves are required to add up.
    const port = await freePort()
    const started = spawnInstance(environment(port))

    try {
      const code = await Promise.race([
        started.exited,
        new Promise<"timed out">((resolve) => setTimeout(() => resolve("timed out"), 30_000)),
      ])
      expect(code, `Output:\n${started.output()}`).not.toBe(0)
      // The store seam's own refusal, not merely the string "DATABASE_URL"
      // appearing somewhere. A composition root with the URL written into it
      // also fails here — against a database with no tables — and its message
      // names DATABASE_URL too, so the looser assertion cannot tell "the
      // variable is unset" from "the variable is ignored".
      expect(started.output()).toContain("DATABASE_URL is not set")
      await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow()
    } finally {
      started.child.kill("SIGKILL")
    }
  }, 60_000)
})

describe.skipIf(availability.mode === "skip")("run/an-unmigrated-database-refuses-by-name", () => {
  it("refuses to start against a database the migration was never applied to", async () => {
    // The operator mistake this is about is not hypothetical: applying
    // `migrations/0001-the-recipe-store.sql` is a manual step, documented in
    // `.env.example` and in no way enforced, so first start against an empty
    // database is the likeliest way this instance is ever misconfigured.
    //
    // Without the startup read in `main.ts` the process binds happily and every
    // library request is a 500 — configured wrongly, running anyway, discovered
    // by a user. `StoreNotMigratedError` already said "before starting the
    // instance"; this case is what makes that sentence true rather than
    // aspirational.
    if (availability.mode !== "run") throw new Error("unreachable: the suite is skipped")

    // A schema that exists and is EMPTY. Created rather than merely named, so
    // the refusal is unambiguously about absent tables and not about a
    // `search_path` entry Postgres quietly ignores.
    const schema = `cf_unmigrated_${randomBytes(6).toString("hex")}`
    const admin = new Client({ connectionString: availability.url })
    await admin.connect()
    try {
      await admin.query(`create schema "${schema}"`)
    } finally {
      await admin.end().catch(() => {})
    }

    const port = await freePort()
    const started = spawnInstance(environment(port, urlForSchema(availability.url, schema)))

    try {
      const code = await Promise.race([
        started.exited,
        new Promise<"timed out">((resolve) => setTimeout(() => resolve("timed out"), 30_000)),
      ])
      expect(code, `Output:\n${started.output()}`).not.toBe(0)
      // Named as the operator's missing step, not as a driver error about a
      // relation — which is the whole difference the refusal exists to make.
      expect(started.output()).toContain("migrations/0001-the-recipe-store.sql")
      // And it arrives as ITSELF rather than wrapped in the generic
      // could-not-be-read refusal. Both messages happen to carry the filename,
      // so without this line the branch that distinguishes an empty database
      // from an unreachable one is unguarded and could be deleted.
      expect(started.output()).not.toContain("could not be read")
      // And nothing bound, so there is no instance answering out of a database
      // it cannot read.
      await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow()
    } finally {
      started.child.kill("SIGKILL")
      const cleanup = new Client({ connectionString: availability.url })
      await cleanup.connect()
      try {
        await cleanup.query(`drop schema if exists "${schema}" cascade`)
      } finally {
        await cleanup.end().catch(() => {})
      }
    }
  }, 60_000)
})

describe.skipIf(availability.mode === "skip")("wire/a-restart-keeps-the-library", () => {
  it("what one process serves, the next process started against the same database still serves", async () => {
    // The point of the whole unit, measured across a real stop.
    //
    // `persistence/a-restart-keeps-the-library` (CFV1-PG) already proves the
    // STORE keeps what one process wrote for another to read. What it cannot
    // prove is that the instance an operator starts is built on that store —
    // and until this unit it was not: `main.ts` constructed the in-memory one,
    // so every route answered exactly as its proofs required and the library
    // was empty again after `SIGTERM`. Nothing in the output was wrong, which
    // is why only a proof spanning two processes could see it.
    //
    // **What this does NOT do, stated rather than implied:** the recipes are
    // written through the store's own factory, not posted to `/capture`. That
    // route runs the model pipeline, and a spawned process has no provider to
    // run it against — a real key is money, and a fake one is a 401. So the
    // write path over HTTP stays where it is already measured
    // (`run/served-instance` with fake providers, in process), and what this
    // proof owns is the half neither of those covers: the process an operator
    // starts reads and keeps its library across a restart.
    const schema = await ownSchema()

    // Written through the product's own factory, at the same seam `main.ts`
    // uses. Not a test-only writer, and not raw SQL: a fixture inserted by hand
    // could be shaped in a way no store would ever produce.
    const before = createPostgresStore(schema.url)
    try {
      await before.repository.appendCanonicalVersion(canonical("r-before", "Kartoffelgratin"))
    } finally {
      await before.close()
    }

    const port = await freePort()
    const first = spawnInstance(environment(port, schema.url))
    let second: Started | undefined
    try {
      await waitFor(first, /listening on port/)
      expect(await library(port)).toContain("Kartoffelgratin")

      // Written WHILE the first process is running, and required on its next
      // request. This is what separates "reads the database" from "read the
      // database once at startup and kept a copy": an instance that cached its
      // library would pass the line above and fail this one.
      const during = createPostgresStore(schema.url)
      try {
        await during.repository.appendCanonicalVersion(canonical("r-during", "Zwiebelkuchen"))
      } finally {
        await during.close()
      }
      expect(await library(port)).toContain("Zwiebelkuchen")

      // A real stop, not a kill: the same signal a container runtime sends, and
      // a clean exit code, so what follows is a restart rather than a recovery.
      first.child.kill("SIGTERM")
      expect(await first.exited, `Output:\n${first.output()}`).toBe(0)
      await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow()

      // A SECOND process. It shares nothing with the first but the connection
      // string — different port, its own environment, its own store.
      const nextPort = await freePort()
      second = spawnInstance(environment(nextPort, schema.url))
      await waitFor(second, /listening on port/)
      const after = await library(nextPort)
      expect(after).toContain("Kartoffelgratin")
      expect(after).toContain("Zwiebelkuchen")

      second.child.kill("SIGTERM")
      expect(await second.exited, `Output:\n${second.output()}`).toBe(0)
    } finally {
      first.child.kill("SIGKILL")
      second?.child.kill("SIGKILL")
    }
  }, 120_000)
})

describe("wire/the-process-runs-the-durable-store", () => {
  it("no module under src/ constructs the provisional store", () => {
    // The criterion is about the TREE, not about one file. A second module
    // reaching for the in-memory store is how an instance ends up durable on
    // one path and forgetful on another, and the barrel still exports it on
    // purpose — the repository contract suite needs two implementations to be a
    // contract at all, so the export is not the thing to forbid. The
    // CONSTRUCTION is.
    const constructors: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith(".ts")) {
          if (/createProvisionalStore\s*\(/.test(readFileSync(full, "utf8"))) {
            constructors.push(full)
          }
        }
      }
    }
    walk(join(repoRoot, "src"))
    // Its own definition, and nothing else.
    expect(constructors.map((p) => p.replace(`${repoRoot}/`, ""))).toEqual([
      "src/persistence/provisional-store.ts",
    ])
  })

  it("the entry point builds the durable store from the seam that reads the environment", () => {
    // Two claims, because either alone is passed by something wrong: a file
    // that names `createPostgresStore` may still hand it a URL it assembled
    // itself, and a file that no longer names the provisional store may
    // construct nothing at all.
    const entry = readFileSync(join(repoRoot, "src", "server", "main.ts"), "utf8")
    expect(entry).toMatch(/createPostgresStore\(resolveDatabaseUrl\(\)\)/)
    expect(entry).not.toMatch(/createProvisionalStore/)
  })
})
