/**
 * The URL path's collaborators, as a proof gets them when it does not ask.
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
import type { CaptureProvider } from "../../src/pipeline/providers.js"
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

/** The sentence a proof sees when it reaches the URL route without asking for a capture path. */
export const NO_URL_CAPTURE_SUPPLIED =
  "this proof reached the URL route without supplying a url capture provider"

/**
 * The same argument as the byte source above, for the seam the review's BLOCK
 * was about.
 *
 * `urlCapture` is required for the same reason `byteSource` is, and it is a
 * SEPARATE field from `capture` rather than a default falling back to it. A
 * default would have been the defect: the first version of this route passed
 * the photo path's provider, so every fetched page went whole to the model and
 * the deterministic reader was never on the path. A field that cannot be
 * omitted makes the next composition state its answer, and this value makes a
 * proof that reaches the route without one say so instead of quietly passing.
 */
export function unsuppliedUrlCapture(): CaptureProvider {
  return {
    capture: async () => {
      throw new Error(NO_URL_CAPTURE_SUPPLIED)
    },
  }
}
