/**
 * CFV1-HDR — the shipped miss header factory returns a record that belongs to one
 * response, proved by REFERENCE rather than by a runtime symptom.
 *
 * ## Why this proof exists at all
 *
 * Two guards already stand around the fresh-copy convention, and neither of them
 * can see inside a factory:
 *
 *  - `tests/unit/response-header-record.test.ts` reads every `c.body(...)` call in
 *    `src/` and flags a header record that outlives one response. A factory CALL
 *    (`notFoundHeaders()`) constructs something per response by definition, so it
 *    is spared on purpose — the scan never follows the call into the factory's
 *    body.
 *  - `tests/run/adapter-does-not-mutate-the-header-record.test.ts` used to catch the body
 *    instead, by symptom: with `@hono/node-server` up to 2.1.1 a factory handing
 *    out its module constant made the second miss a 500 over a real socket. 2.1.2
 *    removed that mutation (`fix(listener): avoid mutating response headers when
 *    setting Content-Length`, #402), so the symptom is gone and the proof with it.
 *
 * Between the two, `notFoundHeaders()` returning `NOT_FOUND_HEADERS` itself instead
 * of a copy went from caught to caught by nothing. This file is what catches it,
 * and it does so without depending on the adapter's behaviour at all: a factory
 * whose job is a fresh record per response must not hand the same object out twice.
 * Measured against the planted body (`return NOT_FOUND_HEADERS as unknown as
 * Record<string, string>`, the mutation `tests/protections/majors.ts` carries for
 * this subject): red.
 *
 * ## Declared breadth, because an enumeration is not a universal
 *
 * This file holds ONE factory — `notFoundHeaders`, the only one `src/` exports.
 * `pageHeaders` and `handoffHeaders` in `src/http/pages-app.ts` are module-private
 * and cannot be reached from a test, so their bodies are guarded by nothing here.
 * That gap is not opened by this file and is not new: both build multi-key records,
 * which the adapter never wrote back into even at 2.1.1, so the behavioural proof
 * could not see them either (the structural guard's header says so in as many
 * words). Closing the class needs a different shape — a source scan that resolves
 * each factory used in a headers slot and requires its returned expression to be a
 * fresh construction — and that is routed as its own item rather than smuggled into
 * a dependency bump.
 *
 * No fixture here binds a socket, reads a recipe or costs anything.
 */

import { describe, expect, it } from "vitest"
import { notFoundHeaders } from "../../src/http/not-found.js"

describe("unit/the-miss-header-factory-returns-a-fresh-record", () => {
  it("hands out a different object on every call", () => {
    // The property, stated directly. A factory that returns its module constant
    // satisfies every value assertion and fails this one.
    expect(notFoundHeaders()).not.toBe(notFoundHeaders())
  })

  it("hands out the header a miss actually carries", () => {
    // Freshness must not have been bought by returning something else, so the
    // record's CONTENT is pinned here — against an inline literal, not against a
    // second call of the factory. Comparing the factory with itself passes for any
    // deterministic factory, so a no-op would satisfy it; and a single call cannot
    // assert cross-call stability anyway, which is why this is named for the
    // content rather than for "every call". The literal is written out rather than
    // read from `NOT_FOUND_HEADERS`, which this module cannot reach, so it cannot
    // follow the constant it pins.
    expect(notFoundHeaders()).toEqual({ "content-type": "text/plain; charset=utf-8" })
  })

  it("does not carry a key written into one response's record into the next", () => {
    // The consequence the convention exists for, without an adapter: whatever a
    // response builder writes into the record it was handed must not reach the
    // next response. This is the shape the adapter itself used to produce, with
    // `Content-Length` as a number.
    const first = notFoundHeaders() as Record<string, unknown>
    first["content-length"] = 5

    expect(notFoundHeaders()).not.toHaveProperty("content-length")
  })
})
