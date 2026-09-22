/**
 * Everything the running instance is configured with, read once and refused
 * when absent (CFV1-RUN).
 *
 * The rule this module exists to keep is one line of the unit's specification:
 * configuration is "refused when absent, never defaulted into something that
 * appears to work". A default port, a default credential or a silently empty API
 * key each produce an instance that starts, answers, and is wrong in a way the
 * operator finds out about later — from a 401 they cannot explain, or from a
 * library anyone can read. So there is no default in this file at all, and the
 * refusal names every variable at fault in one message rather than one per
 * restart.
 *
 * It is a pure function of an environment mapping. It reads no `process.env`, no
 * file and no network, which is what lets `run/absent-configuration-refuses-by-
 * name` check every missing combination without a process. The one place that
 * touches the real environment is `main.ts`, which reads it exactly once.
 */

/** The configured values the process needs to serve. Nothing optional. */
export interface InstanceConfiguration {
  /** The TCP port to bind. */
  readonly port: number
  /** Which model provider to construct. Validated by the composition root. */
  readonly modelProvider: string
  /** The provider credential. PDR-0001 invariant 8: it never leaves the server. */
  readonly modelApiKey: string
  /** The model identifier a capture or normalization run is charged against. */
  readonly model: string
  /** The secret the iOS Shortcut presents to submit a capture (PDR-0003). */
  readonly ingestCredential: string
  /**
   * The secret that opens the library and recipe pages — a DIFFERENT value from
   * {@link ingestCredential}. PDR-0003 says the phone's credential grants no
   * access to the library, so the instance holds two secrets rather than one.
   * See `src/http/pages-app.ts` for the rule they enforce.
   */
  readonly libraryCredential: string
  /**
   * The public address this instance is reachable at, with no trailing slash
   * required — what a capability URL is built on (ADR-0016, ADR-0017).
   *
   * It is configuration rather than something the process can work out. Bring
   * fetches a recipe **server-side from its own infrastructure**, so the address
   * has to be the one that works from outside; the serving route is
   * origin-agnostic on purpose and the only other source would be the request's
   * own `Host` header, which a caller writes. An instance behind a reverse proxy
   * cannot see its public name at all.
   */
  readonly publicBaseUrl: string
  /**
   * The directory the byte store keeps captured photographs in (ADR-0009): on a
   * deployment, the mounted volume (ADR-0026's second cut, "byte storage reaches
   * the platform as a directory path and nothing else").
   *
   * Required rather than defaulted for the reason every other value here is. A
   * default directory would be one inside the container's own filesystem, which
   * a stopped machine does not keep — so an instance without a volume would take
   * photographs, answer 201, and lose them on its next stop, while `PDR-0001`'s
   * tenth invariant says a scan is not deleted until the capture-quality gate
   * passes. Refusing to start is the only answer that cannot look like success.
   */
  readonly storageRoot: string
}

/** One variable that is missing or unusable, and why. */
export interface ConfigurationProblem {
  readonly name: string
  readonly problem: string
}

/**
 * Raised when the environment cannot configure an instance. Carries every fault
 * found, so an operator fixes them in one pass instead of one restart each.
 */
export class ConfigurationError extends Error {
  constructor(readonly problems: readonly ConfigurationProblem[]) {
    super(
      `cookframe cannot start: ${problems.map((p) => `${p.name} ${p.problem}`).join("; ")}. ` +
        "See .env.example for what each value is.",
    )
    this.name = "ConfigurationError"
  }

  /** The variable names at fault, in the order they are declared. */
  get names(): readonly string[] {
    return this.problems.map((p) => p.name)
  }
}

/** The environment variables an instance is configured with, in refusal order. */
export const REQUIRED_CONFIGURATION: readonly string[] = [
  "PORT",
  "MODEL_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "COOKFRAME_INGEST_CREDENTIAL",
  "COOKFRAME_LIBRARY_CREDENTIAL",
  "PUBLIC_BASE_URL",
  "STORAGE_ROOT",
]

/** An environment as this module reads it: names to values, nothing more. */
export type Environment = Readonly<Record<string, string | undefined>>

/**
 * Read the configuration, or throw {@link ConfigurationError} naming every fault.
 *
 * A variable that is present but empty counts as absent: `PORT=` in a `.env`
 * file is a value the operator believes they set, and treating it as unset is
 * the reading that fails closed.
 */
export function readConfiguration(env: Environment): InstanceConfiguration {
  const problems: ConfigurationProblem[] = []
  const required = (name: string): string => {
    const value = env[name]
    if (value === undefined || value.trim() === "") {
      problems.push({ name, problem: "is not set" })
      return ""
    }
    return value
  }

  // Read in the declared order, so the refusal lists variables the way
  // `.env.example` does rather than in whatever order a check happened to run.
  const rawPort = required("PORT")
  const modelProvider = required("MODEL_PROVIDER")
  const modelApiKey = required("OPENAI_API_KEY")
  const model = required("OPENAI_MODEL")
  const ingestCredential = required("COOKFRAME_INGEST_CREDENTIAL")
  const libraryCredential = required("COOKFRAME_LIBRARY_CREDENTIAL")
  const rawPublicBaseUrl = required("PUBLIC_BASE_URL")
  const storageRoot = required("STORAGE_ROOT")

  // A port that is not a port is a fault of the same kind as an absent one: the
  // process would otherwise bind something nobody asked for, or fail with a
  // message about a number rather than about a variable.
  //
  // Trimmed before parsing — `PORT="8080 "` is 8080, and a trailing space in an
  // environment file is a typo, not a different port. The SECRETS above are
  // deliberately not trimmed the same way: trimming a credential would make two
  // different secrets compare equal, which is the opposite trade.
  const port = Number(rawPort.trim())
  if (rawPort !== "" && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    problems.push({
      name: "PORT",
      problem: `is not a port number (got ${JSON.stringify(rawPort)})`,
    })
  }

  // The two secrets must not be the same value. PDR-0003 scopes the phone's
  // credential to submission and says losing the device does not expose the
  // library; one secret in both variables makes that sentence false while every
  // route still behaves, which is the kind of misconfiguration nothing else
  // would ever report.
  if (
    ingestCredential !== "" &&
    libraryCredential !== "" &&
    ingestCredential === libraryCredential
  ) {
    problems.push({
      name: "COOKFRAME_LIBRARY_CREDENTIAL",
      problem:
        "is the same value as COOKFRAME_INGEST_CREDENTIAL, which would let the phone's " +
        "credential open the library (PDR-0003)",
    })
  }

  // A base URL that is not usable as one is a fault of the same kind as an absent
  // one: the instance would start, mint capability URLs nobody can fetch, and the
  // operator would find out from Bring failing to import rather than from here.
  //
  // Four refusals, each with a reason of its own rather than one "looks wrong":
  //
  //  - **not a URL at all** (`example.test`, `/cookframe`) — a relative value is
  //    the mistake a reader of `.env.example` makes, and it produces a link that
  //    is only correct when read on the instance itself.
  //  - **a scheme Bring cannot fetch.** `http` and `https` are both accepted, and
  //    that is deliberate rather than an oversight: a proxy that terminates TLS is
  //    the ordinary deployment, and the proofs here serve a real instance over
  //    `http://127.0.0.1`. The cost is stated where it falls — an `http` public
  //    base carries the capability token, which lives in the PATH (ADR-0016), in
  //    clear over the wire. Nothing refuses it and nothing guards it.
  //  - **a credential in the URL** (`https://user:pw@host`). This value is handed
  //    out: it goes into every capability URL, and a capability URL is designed to
  //    leave the device (ADR-0016). A password in it leaves with it.
  //  - **a query or a fragment.** The token is appended as a path, so
  //    `https://host/?a=b` would mint `https://host/?a=b/r/<token>` — an address
  //    that is not the recipe's, silently.
  const publicBaseUrl = rawPublicBaseUrl.trim()
  if (publicBaseUrl !== "") {
    const fault = publicBaseUrlFault(publicBaseUrl)
    if (fault !== undefined) problems.push({ name: "PUBLIC_BASE_URL", problem: fault })
  }

  if (problems.length > 0) throw new ConfigurationError(problems)

  return {
    port,
    modelProvider,
    modelApiKey,
    model,
    ingestCredential,
    libraryCredential,
    publicBaseUrl,
    storageRoot,
  }
}

/** Why this value cannot be a public base URL, or `undefined` when it can. */
function publicBaseUrlFault(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return `is not an absolute URL (got ${JSON.stringify(value)})`
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `is not an http or https URL (got ${JSON.stringify(value)})`
  }
  if (url.username !== "" || url.password !== "") {
    return "carries a credential, which every capability URL built on it would carry off-device"
  }
  if (url.search !== "" || url.hash !== "") {
    return "carries a query or fragment, which a capability path appended to it would follow"
  }
  return undefined
}
