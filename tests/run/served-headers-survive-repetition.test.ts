/**
 * CFV1-HDR — the header record served over a real socket, twice.
 *
 * This is the BEHAVIOURAL half of the unit; the structural half is
 * `tests/unit/response-header-record.test.ts`. Both exist because neither alone
 * is enough:
 *
 *  - `@hono/node-server` writes the content length back into the very record a
 *    handler passed to `c.body(...)` (`header["Content-Length"] = ...`). A record
 *    reused across responses is therefore poisoned by the first one and the
 *    SECOND response over it is a 500. `app.request(...)` never touches that
 *    adapter, so nineteen pull requests could not see it; only a real socket can.
 *    That is what this file adds — and it asks TWICE, because one request passes
 *    either way.
 *  - But the runtime symptom only appears on a ONE-KEY record: with more than one
 *    key Hono builds a `Headers` object and never writes back into the caller's
 *    record (both measured below and in the structural test's header). So a
 *    behavioural proof cannot catch a two-key regression like `pageHeaders`'s at
 *    all — that is the structural guard's job. This file pins the mechanism and
 *    the one-key helper the instance actually ships (`notFoundHeaders`).
 *
 * `serve` is used directly here rather than through `tests/run/harness.ts`,
 * because the control needs a handler that deliberately reuses a bad record — the
 * real instance never would. The chokepoint scan (`tests/url-fetch/network-chokepoint.test.ts`)
 * scans `src/` only, and `@hono/node-server` is a legitimate test dependency.
 *
 * Every fixture is a bare string body; no recipe text, no credential, no cost.
 */

import type { AddressInfo } from "node:net"
import { serve } from "@hono/node-server"
import { type Handler, Hono } from "hono"
import { afterEach, describe, expect, it } from "vitest"
import { NOT_FOUND_BODY, NOT_FOUND_STATUS, notFoundHeaders } from "../../src/http/not-found.js"

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

describe("run/a-reused-header-record-poisons-the-next-response", () => {
  it("a shared one-key record answers the FIRST request and 500s every one after", async () => {
    // The defect, made executable. The adapter mutates this object on the first
    // response; the second takes the non-string branch and throws.
    const shared: Record<string, string> = { "content-type": "text/plain" }
    const origin = await serving((c) => c.body("hello", 200, shared))

    // If this ever reads [200, 200, 200], @hono/node-server has stopped writing
    // back into the caller's record: the premise behind `notFoundHeaders()` and
    // `pageHeaders()` would no longer hold, and the fresh-copy precaution could be
    // revisited. So a change here is a signal, not merely a break.
    expect(await statusesOf(origin, 3)).toEqual([200, 500, 500])
  })

  it("a FRESH one-key record per response answers every request the same", async () => {
    // The fix, made executable: a new object each call has nothing poisoned to
    // carry into the next response.
    const origin = await serving((c) => c.body("hello", 200, { "content-type": "text/plain" }))
    expect(await statusesOf(origin, 3)).toEqual([200, 200, 200])
  })
})

describe("run/the-shipped-not-found-helper-is-fresh-per-response", () => {
  it("serves the same miss over and over, never a 500, over a real socket", async () => {
    // The instance's one-key miss headers come from `notFoundHeaders()`. This
    // binds that shipped helper to the mechanism above: mutate it to return a
    // shared reference and the second miss becomes a 500 — planted and confirmed
    // red. `run/absent-and-forbidden-are-one-answer` proves the same helper is
    // fresh through the whole instance; this proves the helper itself, in
    // isolation, so a regression is localized rather than diagnosed end to end.
    const origin = await serving((c) => c.body(NOT_FOUND_BODY, NOT_FOUND_STATUS, notFoundHeaders()))
    expect(await statusesOf(origin, 3)).toEqual([
      NOT_FOUND_STATUS,
      NOT_FOUND_STATUS,
      NOT_FOUND_STATUS,
    ])
  })
})
