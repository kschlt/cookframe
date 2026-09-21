/**
 * The URL byte source (CFV1-SL4): the one adapter that turns a URL into bytes for
 * the ingest pipeline, and the one place the safe-fetch connector is *invoked*.
 *
 * The safe-fetch connector (ADR-0010, `safe-fetch.ts`) is the egress chokepoint —
 * it decides whether a URL may be fetched and enforces the fail-closed bounds. But
 * a connector nobody calls moves no bytes; the pipeline needs a seam that calls it
 * and hands the pipeline exactly what it needs (the fetched bytes and the final,
 * post-redirect URL) without leaking the connector's transport shape upward.
 *
 * This module lives in `src/security/` deliberately, not for convenience: the
 * chokepoint scan (tests/url-fetch/network-primitives.ts) forbids any network
 * primitive in `src/` *outside* `src/security/`, and `fetcher.fetch(` matches its
 * `\bfetch\s*\(` pattern. Invoking the connector is a security-boundary act, so
 * the invocation belongs here beside the connector, and the pipeline composes this
 * seam by its domain interface. The pipeline never sees `SafeFetcher` or `fetch`.
 *
 * A fetch that violates a bound throws `SafeFetchError` (with its discriminable
 * `reasonCode`) straight through — the byte source adds no policy of its own, so
 * the guard's verdict is the byte source's verdict.
 */

import { createSafeFetcher, type SafeFetcherOptions, type SafeFetchResult } from "./safe-fetch.js"

/**
 * What a URL fetch yields to the pipeline: the response bytes and the final URL
 * the fetch resolved to after any redirects. Deliberately a domain-owned shape
 * (a re-export of the connector's typed result), never a `Response` or a
 * `SafeFetcher` — the pipeline composes a byte source, not a transport.
 */
export type UrlFetchResult = SafeFetchResult

/**
 * The pipeline-facing seam for fetching a URL into bytes. One method to load, and
 * a `close` to release the connector's connection pool (the connector holds an
 * undici pool open across calls). The pipeline depends on this interface; only
 * this module knows a `SafeFetcher` is behind it.
 */
export interface UrlByteSource {
  /**
   * Fetch `url` through the safe-fetch guard and return its bytes and final URL.
   * Throws `SafeFetchError` (carrying a discriminable `reasonCode`) if the guard
   * refuses the URL or a fail-closed bound is exceeded — the byte source does not
   * catch or reshape it.
   */
  load(url: string): Promise<UrlFetchResult>
  /** Release the underlying connector's connection pool. */
  close(): Promise<void>
}

/**
 * Create a {@link UrlByteSource} backed by the ADR-0010 safe-fetch connector.
 *
 * `options` are the connector's own {@link SafeFetcherOptions}. The loopback and
 * resolver seams among them are test-only (the connector's discipline), so
 * production passes no options and gets the fail-closed defaults; a test passes
 * `allowLoopback` and/or a stub `resolve` to reach a local server.
 */
export function createSafeUrlByteSource(options: SafeFetcherOptions = {}): UrlByteSource {
  const fetcher = createSafeFetcher(options)
  return {
    load(url: string): Promise<UrlFetchResult> {
      return fetcher.fetch(url)
    },
    close(): Promise<void> {
      return fetcher.close()
    },
  }
}
