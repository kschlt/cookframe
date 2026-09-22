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
 */
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { createServer } from "node:net"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { NOT_FOUND_BODY, NOT_FOUND_STATUS } from "../../src/http/not-found.js"
import { INGEST_CREDENTIAL, LIBRARY_CREDENTIAL } from "./harness.js"

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

/** The configuration a started instance needs, and nothing else. */
function environment(port: number): Record<string, string> {
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

describe("run/the-process-serves-and-stops", () => {
  it("starts from the declared command, answers on a real socket, and stops cleanly", async () => {
    // Read, not asserted against a literal: if the declared command changes,
    // this proof runs the new one. What it will not tolerate is a command that
    // does not serve.
    expect(declaredStartCommand()).toBeTruthy()

    const port = await freePort()
    const started = spawnInstance(environment(port))

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
})
