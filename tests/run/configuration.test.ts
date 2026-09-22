/**
 * CFV1-RUN — configuration is read once and refused when absent.
 *
 * `process.test.ts` proves the process obeys this, at the cost of a spawn per
 * case. This suite proves the RULE, over every variable, because
 * `readConfiguration` is a pure function of an environment mapping and a rule
 * that holds for one variable and not another is exactly the shape of gap this
 * project keeps finding.
 *
 * Each `describe` string is the proof id it satisfies.
 */
import { describe, expect, it } from "vitest"
import {
  ConfigurationError,
  type Environment,
  REQUIRED_CONFIGURATION,
  readConfiguration,
} from "../../src/server/config.js"
import { INGEST_CREDENTIAL, LIBRARY_CREDENTIAL } from "./harness.js"

/** A complete, valid environment. Every case below removes or spoils one value. */
const complete: Environment = {
  PORT: "8080",
  MODEL_PROVIDER: "openai",
  OPENAI_API_KEY: "not-a-real-key",
  OPENAI_MODEL: "not-a-real-model",
  COOKFRAME_INGEST_CREDENTIAL: INGEST_CREDENTIAL,
  COOKFRAME_LIBRARY_CREDENTIAL: LIBRARY_CREDENTIAL,
  PUBLIC_BASE_URL: "https://cookframe.test",
}

/** `complete` without one variable. */
function without(name: string): Environment {
  const env: Record<string, string | undefined> = { ...complete }
  delete env[name]
  return env
}

describe("run/absent-configuration-refuses-by-name", () => {
  it("reads a complete environment", () => {
    const config = readConfiguration(complete)
    expect(config.port).toBe(8080)
    expect(config.ingestCredential).toBe(complete["COOKFRAME_INGEST_CREDENTIAL"])
    expect(config.libraryCredential).toBe(complete["COOKFRAME_LIBRARY_CREDENTIAL"])
  })

  it("refuses EVERY required variable when it is absent, naming it", () => {
    // The list is read off the module, not restated here. A variable added to
    // the configuration and forgotten in this proof would otherwise be the one
    // that defaults silently, which is the whole failure this criterion names.
    expect(REQUIRED_CONFIGURATION.length).toBeGreaterThan(0)

    for (const name of REQUIRED_CONFIGURATION) {
      let thrown: unknown
      try {
        readConfiguration(without(name))
      } catch (error) {
        thrown = error
      }
      expect(thrown, `${name} may be absent without a refusal`).toBeInstanceOf(ConfigurationError)
      const error = thrown as ConfigurationError
      expect(error.names, `the refusal for ${name} does not name it`).toContain(name)
      expect(error.message).toContain(name)
    }
  })

  it("treats a present-but-empty value as absent", () => {
    // `PORT=` in a `.env` file is a value the operator believes they set.
    // Reading it as an empty string and carrying on is how a credential check
    // ends up comparing against "".
    for (const name of REQUIRED_CONFIGURATION) {
      expect(() => readConfiguration({ ...complete, [name]: "" })).toThrow(ConfigurationError)
      expect(() => readConfiguration({ ...complete, [name]: "   " })).toThrow(ConfigurationError)
    }
  })

  it("names every fault at once, so a fix is one pass and not one restart each", () => {
    let thrown: unknown
    try {
      readConfiguration({})
    } catch (error) {
      thrown = error
    }
    const error = thrown as ConfigurationError
    expect([...error.names].sort()).toEqual([...REQUIRED_CONFIGURATION].sort())
  })

  it("refuses a PORT that is not a port, rather than binding something else", () => {
    for (const bad of ["0", "-1", "65536", "8080.5", "http", "8 0 8 0"]) {
      expect(() => readConfiguration({ ...complete, PORT: bad }), bad).toThrow(ConfigurationError)
    }
    // Surrounding whitespace is a typo in an environment file, not a different
    // port, so it is read rather than refused. The credentials are deliberately
    // NOT treated this way: trimming a secret would make two different secrets
    // compare equal, which is the opposite trade.
    expect(readConfiguration({ ...complete, PORT: " 8080 " }).port).toBe(8080)
    const padded = ` ${LIBRARY_CREDENTIAL} `
    expect(
      readConfiguration({ ...complete, COOKFRAME_LIBRARY_CREDENTIAL: padded }).libraryCredential,
    ).toBe(padded)
    // `0` is refused on purpose and not as an accident of the range: it asks the
    // operating system for an arbitrary free port, which for an operator is an
    // instance on an address they cannot reach and cannot distinguish from one
    // that did not start.
    expect(() => readConfiguration({ ...complete, PORT: "0" })).toThrow(/is not a port number/)
  })

  it("refuses one secret configured into both credentials (PDR-0003)", () => {
    // Both values are present, both are long enough, and every route still
    // behaves. What breaks is a sentence in an accepted decision record — the
    // phone's credential would open the library, and losing the device would
    // cost exactly what PDR-0003 says it must not. Nothing else in the system
    // would ever report this.
    const shared = INGEST_CREDENTIAL
    expect(() =>
      readConfiguration({
        ...complete,
        COOKFRAME_INGEST_CREDENTIAL: shared,
        COOKFRAME_LIBRARY_CREDENTIAL: shared,
      }),
    ).toThrow(/same value as COOKFRAME_INGEST_CREDENTIAL/)
  })

  it.each([
    ["cookframe.test", /is not an absolute URL/],
    ["/cookframe", /is not an absolute URL/],
    ["", /is not set/],
    ["ftp://cookframe.test", /is not an http or https URL/],
    ["file:///srv/cookframe", /is not an http or https URL/],
    ["https://someone:pw@cookframe.test", /carries a credential/],
    ["https://cookframe.test/?utm=1", /carries a query or fragment/],
    ["https://cookframe.test/#top", /carries a query or fragment/],
  ])("refuses PUBLIC_BASE_URL %j, and says which fault it is", (value, fault) => {
    // Each case is a DIFFERENT sentence, not one "looks wrong" for all of them.
    // A refusal that named no fault would leave the operator guessing which half
    // of their value is the problem, and the three faults below are three
    // different fixes: write the scheme, drop the password, drop the query.
    expect(() => readConfiguration({ ...complete, PUBLIC_BASE_URL: value })).toThrow(fault)
  })

  it.each([
    ["https://cookframe.test", "https://cookframe.test"],
    // A trailing slash survives here and is collapsed where a URL is built, so
    // both spellings of the same address configure the same instance.
    ["https://cookframe.test/", "https://cookframe.test/"],
    // A path prefix is kept: an instance behind a reverse proxy lives under one.
    ["https://example.test/cookframe", "https://example.test/cookframe"],
    // `http` is accepted deliberately — a TLS-terminating proxy is the ordinary
    // deployment, and the proofs that serve a real instance use it.
    ["http://127.0.0.1:8080", "http://127.0.0.1:8080"],
    // Trimmed like PORT: a trailing newline in an environment file is a typo.
    ["  https://cookframe.test  ", "https://cookframe.test"],
  ])("accepts PUBLIC_BASE_URL %j", (value, expected) => {
    expect(readConfiguration({ ...complete, PUBLIC_BASE_URL: value }).publicBaseUrl).toBe(expected)
  })

  it("never returns a default for anything it could not read", () => {
    // The criterion's second half. A refusal that also handed back a partly
    // filled object would let a caller who forgot to catch it start an instance
    // with an empty credential — which `accepts("")` rejects, so the endpoint
    // would look like it is guarded while nothing could ever open it, and the
    // operator would debug the phone.
    expect(() => readConfiguration({})).toThrow(ConfigurationError)
    const config = readConfiguration(complete)
    for (const value of Object.values(config)) {
      expect(value).not.toBe("")
      expect(value).toBeDefined()
    }
  })
})
