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
 * Where a case needs the process to reach something outside it, the way there
 * is changed in that ENVIRONMENT, never in the process. The photograph case
 * routes the model's request to a local refusal through `HTTPS_PROXY`, so the
 * process it asks is the shipped one, composed by `main.ts` as an operator's
 * is. A proof that injected its own transport would be building its own
 * subject, and a fake that ignores a field cannot fail a caller that omits it.
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
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { Duplex } from "node:stream"
import { fileURLToPath } from "node:url"
import { Client } from "pg"
import { afterAll, describe, expect, it, TestRunner } from "vitest"
import { NOT_FOUND_BODY, NOT_FOUND_STATUS } from "../../src/http/not-found.js"
import { createPostgresStore } from "../../src/persistence/index.js"
import {
  decideDatabaseAvailability,
  isReachable,
  MIGRATIONS,
  type ProvisionedSchema,
  provisionSchema,
  urlForSchema,
} from "../persistence/postgres-harness.js"
import { canonical, freePort, INGEST_CREDENTIAL, LIBRARY_CREDENTIAL } from "./harness.js"

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

/** A new, empty directory for one process to keep its photographs in. */
const freshVolume = (): string => mkdtempSync(join(tmpdir(), "cookframe-process-volume-"))

/** Every file under `dir`, at any depth. The byte store's layout is its own; this reads none of it. */
function filesIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
}

/**
 * The configuration a started instance needs, and nothing else.
 *
 * `databaseUrl` is separate because two cases here deliberately leave it out:
 * the refusal cases, which must reach a non-zero exit without a server anywhere
 * near them.
 *
 * `storageRoot` is a new, empty directory unless a case names one, so no two
 * processes here keep photographs in the same place and a case that reads the
 * volume reads only what its own process wrote.
 */
function environment(
  port: number,
  databaseUrl?: string,
  storageRoot: string = freshVolume(),
): Record<string, string> {
  return {
    // `npm` and `node` need these to exist at all; nothing else is inherited.
    PATH: process.env["PATH"] ?? "",
    HOME: process.env["HOME"] ?? "",
    PORT: String(port),
    MODEL_PROVIDER: "openai",
    // Never a real key. A real key would be a real charge, and these proofs
    // have no business making one (the project's budget rule). The one case
    // that submits a photograph routes the model's request to a local refusal
    // (`modelRequestsRefusedLocally`), so the key never leaves the machine.
    OPENAI_API_KEY: "not-a-real-key",
    OPENAI_MODEL: "not-a-real-model",
    COOKFRAME_INGEST_CREDENTIAL: INGEST_CREDENTIAL,
    COOKFRAME_LIBRARY_CREDENTIAL: LIBRARY_CREDENTIAL,
    // The address this spawned instance answers at, which is what a capability
    // URL is built on. It is the real one, so a URL this process mints is a URL
    // this process serves.
    PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
    STORAGE_ROOT: storageRoot,
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

/**
 * How long a spawned process gets to do the first thing it is going to do:
 * announce its port, or refuse and exit.
 *
 * Measured, not chosen (the CFV1-TMO rule). Each proof here waits for one start
 * or one refusal at a time. The slowest single-process proof, schema setup
 * included, took about 0.5 s on an idle four-core machine, 4.1 s with 32 busy
 * loops competing for it, and 6.4 s with 48, which is the load that reproduced
 * the #80 incident. This is about five times the worst of them. A proof that
 * reaches it has met a process that did NEITHER, which is its own finding, and
 * it says so rather than timing out.
 */
const FIRST_ACT_DEADLINE_MS = 30_000

/** The line the process prints once its port is bound, and never before. */
const LISTENING = /listening on port \d+/

/** What a spawned process did first. */
type FirstAct =
  | { readonly printed: string }
  | { readonly exited: number | null }
  | { readonly silent: true }

/**
 * Watch a spawned process until it prints `match`, exits, or runs out of time,
 * and say which came first.
 *
 * This is the one place a proof here waits on a process, and it exists because
 * waiting on only ONE of those turns a wrong outcome into a timeout. A proof that
 * waits for a refusal and gets a process that bound its port instead sat out the
 * whole deadline, and then went red at whichever assertion came next, reading
 * like a hang (measured: 30042 ms, red at the table name, with the port long
 * since announced). The same is true the other way round: a proof waiting for
 * the port sat out the deadline beside a process that had already exited.
 * Watching for both ends the wait at the first thing that happened, so the red
 * names what did.
 *
 * Output is checked before exit, so a process that announces its port and then
 * exits counts as having announced it. That order is what keeps "it bound first,
 * then noticed" from passing as a refusal.
 */
async function firstAct(
  started: Started,
  match: RegExp,
  timeoutMs = FIRST_ACT_DEADLINE_MS,
): Promise<FirstAct> {
  // The deadline is a named failure only while it ends before the case does.
  // Past the case's own budget, a process that does neither ends as a bare
  // vitest timeout again, which is the shape this helper exists to remove. So
  // the ordering is checked where it matters, at every wait, against the budget
  // the running case actually has. An absent budget is a failure too: it would
  // mean the runner stopped saying, and a check that cannot read is not held.
  const budget = TestRunner.getCurrentTest()?.timeout
  if (budget === undefined || budget <= timeoutMs) {
    throw new Error(
      `this case's budget is ${budget} ms, which does not outlast the ${timeoutMs} ms a wait may take`,
    )
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = match.exec(started.output())
    if (found !== null) return { printed: found[0] }
    if (started.child.exitCode !== null || started.child.signalCode !== null) {
      return { exited: await started.exited }
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return { silent: true }
}

/** Wait until `match` appears in the child's output, or say why it never will. */
async function waitFor(started: Started, match: RegExp): Promise<string> {
  const act = await firstAct(started, match)
  if ("printed" in act) return act.printed
  const what =
    "exited" in act
      ? `exited with ${act.exited} before printing ${match}`
      : `neither printed ${match} nor exited within ${FIRST_ACT_DEADLINE_MS} ms`
  throw new Error(`the process ${what}. What it did say:\n${started.output() || "(nothing)"}`)
}

/**
 * Wait for the process to refuse: exit non-zero without ever announcing a port.
 *
 * Every refusal proof here used to race the exit against a 30-second timer and
 * then require the result not to be 0. The string "timed out" is not 0, so that
 * line passed for a process that never exited at all, and the proof went red
 * only later, at whichever assertion first read the output. Here each way of
 * not refusing is its own failure, named for what the process did instead.
 */
async function refusal(started: Started): Promise<void> {
  const act = await firstAct(started, LISTENING)
  const said = `What it said:\n${started.output() || "(nothing)"}`
  if ("printed" in act) {
    throw new Error(`the process started instead of refusing: it printed "${act.printed}". ${said}`)
  }
  if ("silent" in act) {
    throw new Error(
      `the process neither refused nor started within ${FIRST_ACT_DEADLINE_MS} ms. ${said}`,
    )
  }
  if (act.exited === 0 || act.exited === null) {
    throw new Error(`the process exited with ${act.exited}, which is not a refusal. ${said}`)
  }
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
    const volume = freshVolume()
    const started = spawnInstance(environment(port, schema.url, volume))

    try {
      // The process announces its bound port on one line, which is what makes
      // this proof a wait rather than a poll-until-it-answers loop — the
      // difference between a test and a flaky test.
      await waitFor(started, /cookframe listening on port \d+/)

      // The byte store it built is on the directory STORAGE_ROOT named, and it
      // was written before the port opened: the startup probe keeps zero bytes.
      // An empty directory here would mean the process built its store
      // somewhere else, or never used it, and would still serve everything
      // below. Nothing about the store's layout is read — only that the
      // directory the operator named is the one written to.
      expect(filesIn(volume), "the process wrote nothing under STORAGE_ROOT").not.toEqual([])

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
      //
      // This race is not the hollow shape `refusal` replaced. It asserts `toBe(0)`,
      // which "timed out" fails, so a process that ignores the signal is red here
      // under its own message.
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
      await refusal(started)
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
      await refusal(started)
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
      await refusal(started)
      // Named as the operator's missing step, not as a driver error about a
      // relation — which is the whole difference the refusal exists to make.
      expect(started.output()).toContain("migrations/0001-the-recipe-store.sql")
      // And it names the table the FIRST read could not find. Which table is
      // named is the only thing that distinguishes "the probe read the recipe
      // store" from "the probe skipped it and tripped on the plan table one
      // line later" — an empty database makes every read fail, so an assertion
      // that only checks THAT it refused passes with the first read deleted,
      // un-awaited, or its failure swallowed. Both halves are needed: without
      // the negative, naming `cooking_plan` would satisfy the positive too,
      // because the tail both messages share mentions neither table.
      expect(started.output()).toContain("recipe_version")
      expect(started.output()).not.toContain("cooking_plan")
      // And it arrives as ITSELF rather than wrapped in the generic
      // could-not-be-read refusal. Both messages happen to carry the filename,
      // so without this line the branch that distinguishes an empty database
      // from an unreachable one is unguarded and could be deleted.
      expect(started.output()).not.toContain("could not be read")
      // And nothing bound, so there is no instance answering out of a database
      // it cannot read. Both halves: it never announced a port, and nothing is
      // listening on one. The first is what makes the ORDER falsifiable — a
      // process that binds and only then discovers the empty database still
      // exits non-zero with the same message, and would pass every line above.
      expect(started.output()).not.toContain("listening on port")
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

describe.skipIf(availability.mode === "skip")(
  "run/a-volume-that-cannot-be-written-refuses-by-name",
  () => {
    it("refuses to start when STORAGE_ROOT cannot hold a photograph, and says which", async () => {
      // The byte store's half of the start-up reads in `main.ts`. A directory that
      // cannot be written constructs a store without complaint, so without the
      // probe this process binds, answers every page, and fails on the first
      // photograph it is sent — which, since the photo route keeps a photograph
      // before reading it, is every capture.
      //
      // "Cannot be written" is made with a FILE where the directory should be.
      // Permission bits would be the obvious plant and are the wrong one: this
      // suite runs as root in some environments, and root writes through them, so
      // a proof built on them would pass here and measure nothing.
      const schema = await ownSchema()
      const blocker = join(freshVolume(), "not-a-directory")
      writeFileSync(blocker, "")

      const port = await freePort()
      const started = spawnInstance(environment(port, schema.url, blocker))
      try {
        await refusal(started)
        expect(started.output()).toContain("STORAGE_ROOT cannot be written")
        // Refused BEFORE the port opened, both halves as for the database: it
        // never announced one, and nothing answers on it. A process that bound
        // first and failed after would pass the two lines above.
        expect(started.output()).not.toContain("listening on port")
        await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow()
      } finally {
        started.child.kill("SIGKILL")
      }
    }, 60_000)
  },
)

/**
 * Where a spawned process's model request goes instead of to the provider.
 *
 * The photo route hands a photograph to the model once it has kept it, and the
 * composition root wires the real provider transport, which is right and is
 * not what a proof may call. The process is left as it is; only its
 * ENVIRONMENT differs. Node's `fetch` honours `HTTPS_PROXY` when
 * `NODE_USE_ENV_PROXY` is set, so the transport's request arrives here as a
 * `CONNECT` and is refused before a tunnel exists. The key and the photograph
 * never leave the machine, the capture fails the way a provider outage makes
 * it fail, and the refusal is recorded, so a proof can tell a process that
 * asked the model from one that stopped before it.
 *
 * `onRequest` runs when the request arrives, before it is refused. That is the
 * moment the model would first see the photograph.
 */
async function modelRequestsRefusedLocally(onRequest: () => void): Promise<{
  readonly env: Record<string, string>
  readonly asked: string[]
  readonly close: () => Promise<void>
}> {
  const asked: string[] = []
  const server = createServer((_req, res) => {
    asked.push("a plain request")
    res.writeHead(403).end()
  })
  // Held so `close` can end them. A tunnel request is no longer the server's
  // once it has been handed over, and `server.close()` waits on it forever if
  // it is still open, which would turn the case's own teardown into the hang.
  // That is not optional tidiness: a named failure that the teardown then
  // times out over reads exactly like no named failure at all (measured, when
  // this was missing).
  const tunnels = new Set<Duplex>()
  server.on("connect", (req, socket) => {
    tunnels.add(socket)
    asked.push(req.url ?? "")
    onRequest()
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("no port was bound")
  return {
    env: { NODE_USE_ENV_PROXY: "1", HTTPS_PROXY: `http://127.0.0.1:${address.port}` },
    asked,
    close: () => {
      for (const socket of tunnels) socket.destroy()
      return new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

/**
 * How long the photograph case waits for its answer once the process is up.
 * A refused model request answers in milliseconds. That this, plus the
 * start-up wait, fits inside the case's budget is checked where it is spent,
 * against the budget the runner reports, not stated here.
 */
const CAPTURE_ANSWER_MS = 15_000

/** Whether some file under `volume` holds exactly `bytes`. The layout is the store's own. */
function holds(volume: string, bytes: Uint8Array): boolean {
  return filesIn(volume).some((file) => Buffer.from(bytes).equals(readFileSync(file)))
}

describe.skipIf(availability.mode === "skip")(
  "run/a-photograph-sent-to-the-process-is-on-its-volume",
  () => {
    it("keeps a photograph it is sent under STORAGE_ROOT, before the model is asked", async () => {
      // Every other proof that a photograph is kept composes the instance
      // inside the test runner and hands it the store. That left the last link
      // (the store `main.ts` builds and the directory it builds it on)
      // unproven by behaviour. The review of #98 measured it: an ingest app
      // given a store that accepts and discards kept every socket and process
      // proof green. This case sends the photograph to the process an operator
      // starts, and reads the directory the operator named.
      const schema = await ownSchema()
      const volume = freshVolume()
      // Random, so no other file can hold these bytes: not the start-up probe's
      // empty file, and nothing a previous run left behind.
      const photograph = new Uint8Array(randomBytes(4096))

      let keptWhenAsked: boolean | undefined
      const model = await modelRequestsRefusedLocally(() => {
        keptWhenAsked ??= holds(volume, photograph)
      })
      const port = await freePort()
      const started = spawnInstance({ ...environment(port, schema.url, volume), ...model.env })
      try {
        await waitFor(started, /cookframe listening on port \d+/)

        // The answer is waited for here, not through `firstAct`: the process
        // has already bound, so what could go wrong is a request that never
        // comes back, most likely a model request that bypassed the refusal
        // below and is sitting out the transport's own deadline. That is bounded
        // well inside this case's budget and named, rather than left to end as a
        // bare timeout of the case.
        //
        // The bound is only a named failure while both waits end before the
        // case does, so that is read back from the runner here, the way
        // `firstAct` reads it for the start-up wait. This pins the shape of
        // the incident: a case that cannot outlast its own waits. It does not
        // pin that 15 s is the right patience for a refused request; raising
        // all three numbers together stays green, and should.
        const budget = TestRunner.getCurrentTest()?.timeout
        if (budget === undefined || budget <= FIRST_ACT_DEADLINE_MS + CAPTURE_ANSWER_MS) {
          throw new Error(
            `this case's budget is ${budget} ms, which does not outlast the ` +
              `${FIRST_ACT_DEADLINE_MS} ms start-up wait plus the ${CAPTURE_ANSWER_MS} ms this wait may take`,
          )
        }
        const res = await fetch(`http://127.0.0.1:${port}/capture`, {
          method: "POST",
          headers: { authorization: `Bearer ${INGEST_CREDENTIAL}`, "content-type": "image/jpeg" },
          body: photograph,
          signal: AbortSignal.timeout(CAPTURE_ANSWER_MS),
        }).catch((error: unknown) => {
          throw new Error(
            `the process did not answer the capture within ${CAPTURE_ANSWER_MS} ms ` +
              `(model requests it made: ${model.asked.length}). What it said:\n` +
              `${started.output() || "(nothing)"}`,
            { cause: error },
          )
        })

        // The floor. The photograph went the whole way: through the route, to
        // the model, which refused. A process that answered before asking the
        // model would satisfy "kept" below without having carried the
        // photograph the way a real one is carried.
        expect(
          await res.json(),
          "the capture should fail the way a refused model makes it fail",
        ).toEqual({
          error: "capture_failed",
        })
        expect(res.status).toBe(500)
        expect(
          model.asked,
          "the process never asked the model: the photograph did not travel the photo route's whole path",
        ).toEqual(["api.openai.com:443"])

        // The claim. The bytes sent are on the directory STORAGE_ROOT names.
        // They are read back from the files, not asked of the store, since the
        // store's own `put` would write the file being looked for.
        expect(
          holds(volume, photograph),
          "no file under STORAGE_ROOT holds the photograph the process was sent",
        ).toBe(true)
        // And they were already there when the model was asked. A capture that
        // fails is the case the ordering exists for.
        expect(
          keptWhenAsked,
          "the photograph was not yet on the volume when the model was asked for it",
        ).toBe(true)
      } finally {
        started.child.kill("SIGKILL")
        await model.close()
      }
    }, 60_000)
  },
)

describe("wire/the-port-opens-only-behind-a-reachable-store", () => {
  it("refuses by name when DATABASE_URL points at nothing, rather than crashing out of the driver", async () => {
    // The third operator mistake, and the only one of the three that needs no
    // database to prove: a URL that is set and wrong — the wrong host, the wrong
    // port, a password rotated out from under the instance.
    //
    // What is actually being guarded here is the SHAPE of the refusal. The store
    // translates a missing table into a sentence naming the operator's missing
    // step; it cannot translate a refused connection, because there is no
    // relation to name, so the composition root wraps it. Delete that wrapping —
    // or merely stop awaiting the read that produces it — and the process still
    // refuses, still exits non-zero, still never binds, and every line of the two
    // cases above still passes. What changes is the only thing an operator ever
    // sees: a named sentence about DATABASE_URL becomes a `pg-pool` stack frame.
    //
    // So this case reads the FIRST line of output rather than searching the
    // whole of it. An unhandled rejection prints the driver's dump and takes the
    // process down where it stands, so "the refusal is somewhere in the output"
    // is satisfied by a crash that happens to race the catch block; "the refusal
    // is what the process said first" is not.
    const port = await freePort()
    // A port nothing is listening on. `freePort` returns one it has just
    // released, which is precisely what is wanted: a refused connection rather
    // than a hang against a filtered address.
    const nowhere = await freePort()

    const started = spawnInstance(
      environment(port, `postgres://postgres:postgres@127.0.0.1:${nowhere}/postgres`),
    )

    try {
      await refusal(started)

      const firstLine = started.output().trimStart().split("\n")[0] ?? ""
      expect(firstLine, `Output:\n${started.output()}`).toContain(
        "the database at DATABASE_URL could not be read",
      )
      // And the driver's own words survive inside it: the wrapper explains what
      // the failure MEANS, it does not replace what went wrong.
      expect(started.output()).toContain("ECONNREFUSED")
      // Not the empty-database refusal. The two branches are distinct, and a
      // wrapper that swallowed the distinction would send an operator whose
      // server is down to go and run migrations.
      expect(started.output()).not.toContain("apply the migrations in")
      // And nothing bound, for the same reason as above.
      expect(started.output()).not.toContain("listening on port")
      await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow()
    } finally {
      started.child.kill("SIGKILL")
    }
  }, 60_000)
})

/**
 * The table a database is missing when it stops after the first `applied`
 * migrations, one row per place an operator can stop short.
 *
 * Written out rather than read off the migration files, so this is the claim and
 * not a restatement of what the files happen to say. The row count is held
 * against the directory in the proof below: a migration added without a row here
 * is red, which is what keeps a fourth migration from arriving with nothing
 * probing its table at startup.
 */
const MISSING_AFTER: ReadonlyArray<readonly [applied: number, table: string]> = [
  [1, "cooking_plan"],
  [2, "capability_grant"],
]

describe.skipIf(availability.mode === "skip")(
  "run/a-half-migrated-database-refuses-by-name",
  () => {
    it("has a row for every place an operator can stop short", () => {
      // Every proper prefix of the directory, and each of them once.
      expect(MISSING_AFTER.map(([applied]) => applied)).toEqual(
        Array.from({ length: MIGRATIONS.length - 1 }, (_, i) => i + 1),
      )
    })

    for (const [applied, table] of MISSING_AFTER) {
      it(`refuses to start after ${applied} of the migrations, naming \`${table}\``, async () => {
        // The mistake the first migration's proof cannot reach. `migrations/`
        // holds more than one file, an operator applies them by hand, and
        // stopping early leaves a database that answers every read the earlier
        // files back — so a startup read probing only the recipe store lets the
        // instance bind and 500 every route that needs a later table. That is
        // the exact failure ADR-0027 exists to prevent, one migration further
        // along, and it is why the probe reads once per migration-backed area
        // rather than once.
        if (availability.mode !== "run") throw new Error("unreachable: the suite is skipped")

        const schema = `cf_half_${randomBytes(6).toString("hex")}`
        const admin = new Client({ connectionString: availability.url })
        await admin.connect()
        try {
          await admin.query(`create schema "${schema}"`)
          await admin.query(`set search_path to "${schema}"`)
          for (const migration of MIGRATIONS.slice(0, applied)) await admin.query(migration.sql)
        } finally {
          await admin.end().catch(() => {})
        }

        const port = await freePort()
        const started = spawnInstance(environment(port, urlForSchema(availability.url, schema)))

        try {
          await refusal(started)
          // The table it could not read, named. Every earlier table exists
          // here, so a refusal naming one of those would mean the probe never
          // reached this migration's table at all.
          expect(started.output()).toContain(`\`${table}\``)
          expect(started.output()).toContain("migrations/")
          expect(started.output()).not.toContain("listening on port")
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
    }
  },
)

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

/** A capability URL fetched the way Bring fetches it: over TCP, with no credential at all. */
async function capabilityStatus(port: number, token: string): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${port}/r/${token}`)
  await res.arrayBuffer()
  return res.status
}

/** Mint a capability URL the way the operator does: through the share route, with the library credential. */
async function share(port: number, recipeId: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/recipes/${recipeId}/share`, {
    method: "POST",
    headers: { authorization: `Bearer ${LIBRARY_CREDENTIAL}` },
  })
  expect(res.status).toBe(200)
  return ((await res.json()) as { token: string }).token
}

/** Revoke one the same way, and say whether an active grant was revoked. */
async function revoke(port: number, token: string): Promise<boolean> {
  const res = await fetch(`http://127.0.0.1:${port}/shares/${token}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${LIBRARY_CREDENTIAL}` },
  })
  expect(res.status).toBe(200)
  return ((await res.json()) as { revoked: boolean }).revoked
}

describe.skipIf(availability.mode === "skip")("wire/a-restart-keeps-every-capability-grant", () => {
  it("a URL one process serves, the next process started against the same database still serves", async () => {
    // OQ-48, measured across a real stop and killed there. ADR-0016 made the
    // capability URL permanent-but-revocable because Bring keeps it and fetches
    // it again later; ADR-0026 stops the machine when idle. Until ADR-0032 the
    // process an operator starts kept its grants in memory, so a URL minted
    // through the share route answered 200 before `SIGTERM` and 404 after it,
    // next to a recipe page that still answered 200. Every in-process proof
    // stayed green through that, which is why this one spans two processes and
    // does every step the way the operator and Bring do: mint and revoke over
    // the routes, fetch the URL with no credential at all.
    const schema = await ownSchema()
    const seed = createPostgresStore(schema.url)
    try {
      await seed.repository.appendCanonicalVersion(canonical("r-shop", "Linsensuppe"))
    } finally {
      await seed.close()
    }

    let first: Started | undefined
    let second: Started | undefined
    try {
      const port = await freePort()
      first = spawnInstance(environment(port, schema.url))
      await waitFor(first, /listening on port/)

      const kept = await share(port, "r-shop")
      const revoked = await share(port, "r-shop")
      expect(await capabilityStatus(port, kept)).toBe(200)
      // Fetched BEFORE it is revoked, and required to stop answering after:
      // an instance that remembered what it had resolved would keep serving a
      // URL someone believed exposed until the next restart, and revocation is
      // ADR-0016's kill switch.
      expect(await capabilityStatus(port, revoked)).toBe(200)
      expect(await revoke(port, revoked)).toBe(true)
      expect(await capabilityStatus(port, revoked)).toBe(NOT_FOUND_STATUS)

      // A real stop, the signal a container runtime sends when the machine
      // goes idle, and a clean exit, so what follows is a restart.
      first.child.kill("SIGTERM")
      expect(await first.exited, `Output:\n${first.output()}`).toBe(0)

      const nextPort = await freePort()
      second = spawnInstance(environment(nextPort, schema.url))
      await waitFor(second, /listening on port/)
      // The asymmetry OQ-48 measured, killed: the recipe survived the restart
      // (it always did), and now the URL Bring kept for it survives too. The
      // revoked one is still revoked, and revoking it again finds nothing
      // active, so both halves of a grant outlived the process.
      expect(await library(nextPort)).toContain("Linsensuppe")
      expect(await capabilityStatus(nextPort, kept)).toBe(200)
      expect(await capabilityStatus(nextPort, revoked)).toBe(NOT_FOUND_STATUS)
      expect(await revoke(nextPort, revoked)).toBe(false)

      second.child.kill("SIGTERM")
      expect(await second.exited, `Output:\n${second.output()}`).toBe(0)
    } finally {
      first?.child.kill("SIGKILL")
      second?.child.kill("SIGKILL")
    }
  }, 120_000)
})

describe.skipIf(availability.mode === "skip")(
  "run/the-process-hands-out-urls-on-its-configured-address",
  () => {
    it("mints a capability URL on PUBLIC_BASE_URL, and serves the token under it", async () => {
      // The composition root's half of CFV1-SHOP. `shopping-handoff.test.ts`
      // drives the handoff in process, where the harness supplies the address;
      // what only a spawned process can show is that `main.ts` passes the
      // CONFIGURED value through, rather than something it made up or read off a
      // request.
      //
      // Which is why the configured address carries a path prefix no request to
      // this process ever carries. A base URL taken from the request — its
      // `Host`, its path — could not produce `/behind-a-proxy`, and ADR-0026's
      // third cut says the origin comes from configuration and nowhere else. The
      // prefix is what a reverse proxy in front of the instance would strip, so
      // the fetch below strips it too and asks the process for the rest.
      const schema = await ownSchema()
      const seed = createPostgresStore(schema.url)
      try {
        await seed.repository.appendCanonicalVersion(canonical("r-share", "Linsensuppe"))
      } finally {
        await seed.close()
      }

      const port = await freePort()
      const base = `http://127.0.0.1:${port}/behind-a-proxy`
      const started = spawnInstance({ ...environment(port, schema.url), PUBLIC_BASE_URL: base })
      try {
        await waitFor(started, /listening on port/)

        const minted = await fetch(`http://127.0.0.1:${port}/recipes/r-share/share`, {
          method: "POST",
          headers: { authorization: `Bearer ${LIBRARY_CREDENTIAL}` },
        })
        expect(minted.status, `Output:\n${started.output()}`).toBe(200)
        const shared = (await minted.json()) as { token: string; url: string }
        expect(shared.url).toBe(`${base}/r/${shared.token}`)

        const served = await fetch(`http://127.0.0.1:${port}/r/${shared.token}`)
        expect(served.status).toBe(200)
        expect(((await served.json()) as { name?: string }).name).toBe("Linsensuppe")
      } finally {
        started.child.kill("SIGKILL")
      }
    }, 60_000)
  },
)

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
