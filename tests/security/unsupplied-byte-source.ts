/**
 * The byte source a proof gets when it does not ask for one.
 *
 * `IngestAppDeps.byteSource` is REQUIRED rather than optional, and that is the
 * point of this file existing. An optional seam would mean an instance composed
 * without one still came up, with the URL address quietly absent — which is
 * precisely the defect CFV1-URLR closed: the import was built, and a running
 * instance had no way to reach it. Required means a composition that forgets it
 * does not compile.
 *
 * What the required value is, for a proof about the photo route, is then a real
 * question. This answers it with a source that REFUSES. A stub returning bytes
 * would let a proof of the URL route pass with no fetch having happened — the
 * fourth recurring defect shape of this repository, a proof that builds its own
 * subject — so the only thing this can safely do is make its own use visible.
 */
import type { UrlByteSource } from "../../src/security/url-byte-source.js"

/** The sentence a proof sees when it reaches the URL route without asking for a source. */
export const NO_BYTE_SOURCE_SUPPLIED =
  "this proof reached the URL route without supplying a byte source"

export function unsuppliedByteSource(): UrlByteSource {
  return {
    load: async () => {
      throw new Error(NO_BYTE_SOURCE_SUPPLIED)
    },
    close: async () => {},
  }
}
