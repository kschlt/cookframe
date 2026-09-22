/**
 * The one answer every miss gets, across every route this instance serves
 * (CFV1-RUN, ADR-0021).
 *
 * It lives in its own module because two apps have to give **byte-identical**
 * answers, and two copies of the same three values are two things that can
 * drift. The capability route (CFV1-SL3) already equalizes its own misses so
 * that an unknown token, a revoked token and a token whose recipe is gone
 * cannot be told apart. The pages added by CFV1-RUN would have reopened that
 * oracle from the other side: a `401` on a protected recipe page and a `404` on
 * an absent one together let anyone who has never held a credential learn which
 * recipe ids this library holds.
 *
 * So the pages answer a caller with no credential exactly as the capability
 * route answers an unknown token — same status, same body, same content type —
 * and `run/absent-and-forbidden-are-one-answer` compares the two responses
 * rather than trusting this comment.
 *
 * **The cost, stated because it is real:** an operator who forgets to send
 * their credential is told "Not Found", not "you need a credential". A response
 * that explains itself is a response that confirms the address exists. Nothing
 * here can have both, and the library's contents are the thing worth keeping.
 */

/** The body and status of a miss. One definition, both apps. */
export const NOT_FOUND_BODY = "Not Found"
export const NOT_FOUND_STATUS = 404

/**
 * The one header a miss carries. NOT exported: a header record is only ever handed
 * to a response builder through {@link notFoundHeaders}, which copies it, so the
 * constant itself never leaves this module and cannot be handed to `c.body(...)`
 * shared. That is the invariant `response-header-record.test.ts` guards — an
 * exported header record is one misuse away from poisoning a response process-wide.
 */
const NOT_FOUND_HEADERS = { "content-type": "text/plain; charset=utf-8" } as const

/**
 * A FRESH headers object for one response. Never the constant itself.
 *
 * This is not defensive style, it is a measured defect, and it is the first one
 * CFV1-RUN found by binding a socket at all. `@hono/node-server` writes the
 * content length back into the object a handler passed to `c.body(...)`:
 *
 * ```js
 * header["Content-Length"] = Buffer.byteLength(body)   // dist/index.mjs
 * ```
 *
 * `header` there is the caller's own record. A module-level constant handed to
 * `c.body` is therefore mutated by the first response that uses it, and gains a
 * key whose value is a NUMBER. Hono's next response over the same record takes
 * the non-string branch and does `for (const v2 of v)`, which throws
 * `TypeError: v is not iterable` — so the SECOND miss the process serves is a
 * `500`, and every one after it.
 *
 * Nineteen pull requests never saw it because nothing in the repository bound a
 * socket: `app.request(...)` never reaches that code, so the same constant is
 * safe in process and poisoned over HTTP. That is the precise shape of thing
 * this unit exists to surface, and it is also why the equalized-miss proof runs
 * against a real server and asks for the miss TWICE — one miss passes either
 * way.
 */
export function notFoundHeaders(): Record<string, string> {
  return { ...NOT_FOUND_HEADERS }
}
