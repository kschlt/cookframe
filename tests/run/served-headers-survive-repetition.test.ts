/**
 * CFV1-HDR — the upstream premise behind the fresh-copy convention, measured over
 * a real socket.
 *
 * ## What this file used to be, and why it could not stay that
 *
 * Until `@hono/node-server` 2.1.2 this adapter wrote the content length back into
 * the very record a handler passed to `c.body(...)`
 * (`header["Content-Length"] = …` in `dist/index.mjs`). A one-key record reused
 * across responses was therefore poisoned by the first response, Hono's next
 * response over it took the non-string branch and threw, and the SECOND response
 * the process served was a 500. This file made that defect executable: a shared
 * record served three times answered `[200, 500, 500]`.
 *
 * 2.1.2 removed it — `fix(listener): avoid mutating response headers when setting
 * Content-Length` (#402). The same fixture now answers `[200, 200, 200]`, which is
 * exactly what the old assertion's own comment said to treat as a signal rather
 * than a break. So the mechanism can no longer be reproduced here, and every proof
 * in this file that asked whether a response SURVIVES repetition now passes
 * trivially, because there is nothing left to poison. Two such proofs lived here
 * (a fresh record answering alike, and the shipped miss helper served three times)
 * and both are gone: a proof that cannot be red is coverage that proves nothing,
 * and leaving it would have read as a guard.
 *
 * ## What this file is now
 *
 * The one thing a socket can still settle is the PREMISE itself, from the other
 * side: the adapter does not write back into the caller's record. That is the
 * single proof below, and it is red exactly when the premise changes — measured in
 * both directions, against 2.1.1 (red, `[200, 500, 500]`) and against 2.1.3
 * (green). If it ever goes red again, the fresh-copy convention is load-bearing at
 * RUNTIME once more, and the two deleted proofs are worth restoring from history.
 *
 * ## What carries the convention in the meantime
 *
 * The convention itself does not rest on this file and never did:
 *
 *  - `tests/unit/response-header-record.test.ts` reads `src/` and forbids handing
 *    any response builder a record that outlives one response. Version-independent.
 *  - `tests/unit/header-factory-freshness.test.ts` holds the shipped miss factory
 *    to returning a fresh record, by reference rather than by symptom — the proof
 *    that replaces the deleted helper-served-three-times one, and the only thing
 *    that still catches `notFoundHeaders()` handing out its constant.
 *
 * `serve` is used directly here rather than through `tests/run/harness.ts`, because
 * the fixture deliberately reuses one record across responses — the real instance
 * never would. The chokepoint scan (`tests/url-fetch/network-chokepoint.test.ts`)
 * scans `src/` only, and `@hono/node-server` is a legitimate test dependency.
 *
 * Every fixture is a bare string body; no recipe text, no credential, no cost.
 */

import type { AddressInfo } from "node:net"
import { serve } from "@hono/node-server"
import { type Handler, Hono } from "hono"
import { afterEach, describe, expect, it } from "vitest"

let stop: (() => Promise<void>) | undefined

afterEach(async () => {
  await stop?.()
  stop = undefined
})

/**
 * Serve one GET handler on an OS-assigned port over the real node adapter, and
 * return its origin. Remembered for teardown so a failed assertion never leaks a
 * listener.
 */
async function serving(handler: Handler): Promise<string> {
  const app = new Hono()
  app.get("/", handler)
  const server = serve({ fetch: app.fetch, port: 0 })
  await new Promise<void>((resolve) => server.on("listening", () => resolve()))
  stop = () => new Promise<void>((resolve) => server.close(() => resolve()))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

/** The status of GET / fetched `n` times in series, over the socket. */
async function statusesOf(origin: string, n: number): Promise<number[]> {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const res = await fetch(origin)
    await res.text()
    out.push(res.status)
  }
  return out
}

describe("run/the-adapter-does-not-write-back-into-the-caller-header-record", () => {
  it("serves one shared one-key record three times without poisoning it", async () => {
    // A one-key record is the only shape that could ever show the defect: with more
    // than one key Hono builds a `Headers` object and never writes back into the
    // caller's record at all. So this fixture is the strongest form of the premise.
    const shared: Record<string, string> = { "content-type": "text/plain" }
    const origin = await serving((c) => c.body("hello", 200, shared))

    // `[200, 500, 500]` here means the adapter has RESUMED writing the content
    // length back into this record, as it did up to 2.1.1. That is a signal, not a
    // break: the fresh-copy convention would be load-bearing at runtime again, and
    // the behavioural proofs this file used to carry should come back.
    expect(await statusesOf(origin, 3)).toEqual([200, 200, 200])

    // And the premise stated directly, not only through its symptom: nothing was
    // added to the caller's record by serving over it.
    expect(Object.keys(shared)).toEqual(["content-type"])
  })
})
