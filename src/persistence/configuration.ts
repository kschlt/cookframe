/**
 * The one place `DATABASE_URL` is read (CFV1-PG, ADR-0015).
 *
 * Every other module in `src/` reads no environment at all — deployment values
 * arrive as arguments, the way `createFilesystemByteStore` takes its volume
 * directory. This module keeps that true for the database too: it turns the
 * environment into a value once, at the seam, and the store itself takes only a
 * URL and holds nothing else about the world.
 *
 * **Absent is refused, never defaulted.** The DBQ spike falls back to
 * `postgres://postgres:postgres@127.0.0.1:5432/postgres` when the variable is
 * missing, which is right for a spike on a developer's machine and wrong for an
 * instance: a fallback means a misconfigured deployment comes up, appears to
 * work, and writes a library into a database nobody meant to use. Here there is
 * no default, and the refusal names which of the three things was wrong.
 */

/** Why a configured database URL was refused. */
export type DatabaseConfigurationProblem =
  /** The variable is unset, empty, or only whitespace. */
  | "not_configured"
  /** Present, but not a URL at all. */
  | "unparseable"
  /** A URL, but not one a PostgreSQL driver can connect with. */
  | "not_a_postgres_url"

/**
 * Raised when `DATABASE_URL` cannot be turned into a connection string.
 *
 * The message never carries the value: a connection string holds a password,
 * and a refusal is exactly the moment a process writes to a log.
 */
export class DatabaseConfigurationError extends Error {
  constructor(readonly problem: DatabaseConfigurationProblem) {
    super(
      {
        not_configured: "DATABASE_URL is not set; the instance has nowhere to keep its library",
        unparseable: "DATABASE_URL is not a URL",
        not_a_postgres_url: "DATABASE_URL does not name a PostgreSQL connection (postgres:)",
      }[problem],
    )
    this.name = "DatabaseConfigurationError"
  }
}

/** The two schemes `pg` connects with; anything else is refused. */
const POSTGRES_SCHEMES = new Set(["postgres:", "postgresql:"])

/**
 * Read `DATABASE_URL` out of `env` and return it, or throw {@link
 * DatabaseConfigurationError} naming what was wrong.
 *
 * `env` is a parameter rather than a direct `process.env` read so the refusals
 * can be proved without mutating the process the test suite runs in; production
 * calls it with no argument.
 */
export function resolveDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env["DATABASE_URL"]
  if (raw === undefined || raw.trim() === "") throw new DatabaseConfigurationError("not_configured")
  const value = raw.trim()
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new DatabaseConfigurationError("unparseable")
  }
  if (!POSTGRES_SCHEMES.has(parsed.protocol)) {
    throw new DatabaseConfigurationError("not_a_postgres_url")
  }
  return value
}
