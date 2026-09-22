/**
 * The mobile capture entry point (CFV1-SL5, PDR-0003): the one authenticated
 * address a phone submits a photographed recipe page to.
 *
 * The product's central claim is low friction — photograph a page, get a
 * shopping list — and until capture starts where the user is, that claim is
 * asserted rather than tested. This is the address the committed Shortcut posts
 * to, and it exists so the phone never has to open the application first.
 *
 * Three properties shape it, and each is a criterion rather than a preference:
 *
 *  - **One ingestion path.** This route builds no pipeline of its own: it calls
 *    the same {@link ingest} command Slice 1 built, with the same capture,
 *    block-id policy, persistence and normalization behind it. A mobile-specific
 *    Snapshot or Canonical shape would fall outside reprocessing and comparison
 *    for every recipe captured that way, which is why `no-mobile-specific-contract`
 *    is proved by putting the same bytes through both entries and requiring the
 *    persisted results to be identical, not by reading this file.
 *  - **Submission only.** The credential the phone holds decides one thing:
 *    whether this submission is accepted (`instance-credential.ts`). There is no
 *    read route here, no listing, and nothing that takes the ingest credential
 *    and yields another — PDR-0003's "grants no access to the library beyond
 *    submission", and PDR-0001 invariant 8 for the model credential, which no
 *    client ever holds.
 *  - **A refusal arrives as itself.** A page holding several recipes is refused
 *    upstream with its count and titles (CFV1-MR1). That refusal is the one this
 *    product most needs a person to see: the alternative is the silent
 *    truncation that lost three recipes off a magazine spread. So it is answered
 *    with its own status and its own machine-readable fields, and with a
 *    sentence the Shortcut can show, never flattened into "something went wrong".
 *
 * It is a Hono app and nothing more — `app.fetch` is the whole surface
 * (ADR-0007), so it is exercised in-process with `app.request(...)` and binds no
 * socket. The server entry point that runs it, and the origin it runs on, are
 * the operator's (PDR-0002): nothing here knows its own base URL, which is also
 * why the committed Shortcut carries no instance identifier.
 */
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import type { CanonicalVersion, RecipeRepository } from "../persistence/index.js"
import type { BlockIdPolicy } from "../pipeline/block-id-policy.js"
import { ingest } from "../pipeline/ingest.js"
import type { CaptureProvider, NormalizationProvider } from "../pipeline/providers.js"
import { MultipleRecipesError, UnknownRecipeCountError } from "../pipeline/recipe-inventory.js"
import { importFromUrl } from "../pipeline/url-import.js"
import { SafeFetchError } from "../security/safe-fetch.js"
import type { UrlByteSource } from "../security/url-byte-source.js"
import type { ByteStore } from "../storage/index.js"
import { importWording, refusalWording, urlRefusalWording } from "./capture-wording.js"
import type { InstanceCredential } from "./instance-credential.js"
import { bearerCredential } from "./instance-credential.js"

/**
 * What the phone may submit.
 *
 * An allowlist, not a denylist: an unrecognised type is refused rather than
 * handed to a capture provider that would have to guess. It is also no wider
 * than what the model provider reads. HEIC and HEIF were on it once, because
 * that is what an iPhone produces by default, but the provider's vision guide
 * lists PNG, JPEG, WEBP and GIF only, so a HEIC would have been kept, sent,
 * and refused by the vendor, answered as a 500 (from its documentation; no HEIC
 * has been sent to it from here). Refused here, the person reads why before
 * anything is paid for. The Shortcut in `shortcut/` sends `image/jpeg`.
 */
export const ACCEPTED_CAPTURE_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"]

/** The refusal for a type off the list. */
const UNSUPPORTED_TYPE_BODY = {
  error: "unsupported_media_type",
  message: `this instance accepts ${ACCEPTED_CAPTURE_TYPES.join(", ")}`,
} as const

/**
 * The refusal for a HEIF photograph, by its declared type or by its bytes. The
 * same first clause, and the one thing a person can do about it: a PDF is not
 * told how to send a HEIC.
 */
const HEIF_REFUSED_BODY = {
  error: "unsupported_media_type",
  message: `${UNSUPPORTED_TYPE_BODY.message}; a HEIC or HEIF photo has to be sent as JPEG`,
} as const

/** The declared types that name a HEIF photograph, answered with {@link HEIF_REFUSED_BODY}. */
const HEIF_TYPES: readonly string[] = ["image/heic", "image/heif"]

/**
 * Whether the bytes are an ISO base media file — the container HEIC, HEIF and
 * AVIF all use, marked by an `ftyp` box at offset 4. None of the accepted
 * formats starts that way (JPEG is `FF D8 FF`, PNG `89 50 4E 47`, WEBP
 * `RIFF`), so a body that does is a HEIF-family image whatever its label says.
 * The label is the phone's claim, and a camera set to High Efficiency makes
 * HEIC; checked here so that claim being wrong costs a sentence, not a call.
 */
function isIsoBaseMediaFile(bytes: Uint8Array): boolean {
  return bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
}

/**
 * The largest submission accepted, in bytes. Generous next to a phone
 * photograph — a 12 MP HEIC is a few megabytes.
 *
 * **What the bound does, stated exactly, because the previous wording here
 * claimed more than the code delivered.** It was written as though the limit
 * kept an unbounded body out of the instance's memory. It did not: the handler
 * reached `await c.req.arrayBuffer()` first, so the whole body was already
 * materialized by the time `byteLength` could be compared. The check was real
 * and worth having — nothing oversized reached capture, persistence or a paid
 * model call — but the sentence about memory was a belief about the code rather
 * than a reading of it. Found by review; no exhaustion was ever measured, and
 * none is claimed here either.
 *
 * It is enforced twice now, and the two do different things:
 *
 *  - {@link bodyLimit} runs BEFORE the handler, and answers an over-declared
 *    `Content-Length` on the header alone; where there is none it counts the
 *    stream and stops at the limit. Its ordering is what `refuses an
 *    over-declared submission before the handler runs at all` proves, by giving
 *    the same request a media type the handler would answer 415 — a 413 can
 *    then only come from something that ran first.
 *
 *    **What is NOT claimed:** that no byte is ever buffered. Measuring that
 *    here would mean measuring the runtime's request plumbing rather than this
 *    route, and an unmeasured claim in this comment is the reason the previous
 *    wording had to be replaced.
 *  - The comparison inside the handler stays, because `bodyLimit` bounds the
 *    transport and this route owes an answer about the SUBMISSION. Removing it
 *    would leave the rule stated in one place only, in middleware, where the
 *    next reader of this file cannot see it.
 *
 * Neither is the operator's first line of defence: PDR-0002 puts the instance
 * behind their own reverse proxy, which is where a real flood stops.
 */
export const MAX_CAPTURE_BYTES = 25 * 1024 * 1024

/** The one answer to an oversized submission, whichever bound refuses it. */
const TOO_LARGE_BODY = {
  error: "capture_too_large",
  message: `this instance accepts at most ${MAX_CAPTURE_BYTES} bytes`,
} as const

/** Identity for one submission. Injected so a proof can make a run reproducible. */
export interface IngestIdentity {
  /** The id the snapshot is stored under. */
  newSnapshotId(): string
  /** The capture run's identity, stamped into `captureProvenance`. */
  newCaptureRunId(): string
  /** The normalization run's identity, stamped into `provenance`. */
  newNormalizationRunId(): string
}

/** The collaborators this route composes; every one injected (ADR-0004). */
export interface IngestAppDeps {
  /** Decides whether a submission is this instance's to accept. */
  readonly credential: InstanceCredential
  readonly repo: RecipeRepository
  readonly capture: CaptureProvider
  readonly normalization: NormalizationProvider
  readonly policy: BlockIdPolicy
  readonly identity: IngestIdentity
  /**
   * Where a submitted photograph is kept (ADR-0009): the byte store, which on a
   * running instance is the filesystem volume `STORAGE_ROOT` names.
   *
   * `PDR-0001`'s tenth invariant keeps scan deletion disabled until the
   * capture-quality gate passes, and ADR-0009 says what follows from it:
   * captured images are RETAINED. Before this field existed nothing on the
   * running path constructed a store, so every photograph was read by the model
   * and then dropped with the request — the invariant held by the code and
   * broken by the instance. `serve/a-photograph-is-kept-before-it-is-read` holds
   * the wiring; `run/a-photograph-is-kept-on-the-volume` holds what it does.
   *
   * Required, like {@link urlCapture}, so a composition that forgets it does
   * not compile. What this does NOT do is record the returned identity on the
   * snapshot: the snapshot has no field for one, and adding it is the
   * owner-gated schema decision `src/pipeline/capture.ts` names. The store is
   * content-addressed, so the photograph stays findable by its bytes.
   */
  readonly scanStore: ByteStore
  /**
   * The egress seam a URL import fetches through (`src/security/url-byte-source.ts`).
   *
   * Injected, like every other collaborator (ADR-0004), and injected HERE rather
   * than constructed inside the handler for a reason this unit measured: the
   * connector behind it holds a connection pool across calls, so a source built
   * per request would open one per import and close none.
   */
  readonly byteSource: UrlByteSource
  /**
   * The capture provider a URL import runs through, SEPARATE from {@link capture}.
   *
   * Two providers rather than one, because the two entries are not the same
   * capability. A photograph has to be read by a model. A recipe page usually
   * publishes its recipe as structured data, so `src/pipeline/url-capture.ts`
   * composes the deterministic reader with a model fallback and hands the model
   * the EXTRACTED TEXT, never the raw HTML (ADR-0019 §4a).
   *
   * This field exists because the first version of this route did not have it:
   * it passed {@link capture}, so a running instance sent every fetched page
   * whole to the model and the deterministic reader — built, guarded and proved
   * across CFV1-SL4 — was never on the path. That is the same defect this unit
   * was written to close, one layer down, and what holds it now is
   * `serve/a-url-import-runs-the-url-capture-path`.
   */
  readonly urlCapture: CaptureProvider
  /** How the URL entry names itself in `captureProvenance`; the photo path has its own pair. */
  readonly urlSourceAdapter: string
  readonly urlAdapterVersion: string
  /** The ontology version a normalization run targets. */
  readonly targetOntologyVersion: string
  /** How this entry point names itself in `captureProvenance`. */
  readonly sourceAdapter: string
  readonly adapterVersion: string
  /**
   * Called with the stored version once the import response has been built,
   * and NEVER awaited — `PDR-0004` forbids a policy that blocks the import
   * request, and a hook this route could wait on would be one. Under `lazy`,
   * `createAfterImport` returns a hook that schedules nothing; under
   * `background` it defers derivation past this turn (`ADR-0008`).
   */
  readonly afterImport?: (version: CanonicalVersion) => void
}

/** The one unauthorized response. Identical for absent and for wrong. */
const UNAUTHORIZED_BODY = { error: "unauthorized" } as const

/** What a URL submission is: a small JSON object carrying one link. */
const URL_SUBMISSION_TYPE = "application/json"

/**
 * The largest URL submission accepted. Three orders of magnitude below the photo
 * bound, because the two bound different things: this one bounds a link, while
 * {@link MAX_CAPTURE_BYTES} bounds an image. The page the link points at is
 * bounded by the safe-fetch guard instead, which owns that bound fail-closed.
 */
export const MAX_URL_SUBMISSION_BYTES = 8 * 1024

/** A submission that carried no usable link, named as the caller's mistake. */
const MISSING_URL_BODY = {
  error: "missing_url",
  message: 'this address expects a JSON object with a "url" string',
} as const

/**
 * Build the mobile ingest app. `POST /capture` takes the image bytes as the
 * request body, authenticated with the instance-scoped ingest credential as a
 * bearer token, and answers with the persisted recipe's identity — or with the
 * refusal, as itself.
 */
export function createIngestApp(deps: IngestAppDeps): Hono {
  const app = new Hono()

  app.post(
    "/capture",
    // Before the handler, so an oversized body is refused rather than read. The
    // answer is the same one the handler gives, so which bound fired is not
    // something a caller can tell — and not something this route's behaviour
    // depends on.
    bodyLimit({ maxSize: MAX_CAPTURE_BYTES, onError: (c) => c.json(TOO_LARGE_BODY, 413) }),
    async (c) => {
      // Absent and wrong are ONE answer. Two would tell someone probing whether a
      // credential exists at all, which is the same oracle the capability route
      // closes for tokens (ADR-0016, ADR-0021).
      if (!deps.credential.accepts(bearerCredential(c.req.header("authorization")))) {
        return c.json(UNAUTHORIZED_BODY, 401)
      }

      // The media type is what the caller knows and the provider cannot reliably
      // infer; it decides the capture provider's vision path. Parameters (`;
      // charset=…`) are stripped before matching, never matched with them.
      const mediaType =
        (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? ""
      if (!ACCEPTED_CAPTURE_TYPES.includes(mediaType)) {
        return c.json(
          HEIF_TYPES.includes(mediaType) ? HEIF_REFUSED_BODY : UNSUPPORTED_TYPE_BODY,
          415,
        )
      }

      const body = new Uint8Array(await c.req.arrayBuffer())
      if (body.byteLength === 0) {
        return c.json({ error: "empty_capture", message: "the submission carried no image" }, 400)
      }
      if (body.byteLength > MAX_CAPTURE_BYTES) {
        return c.json(TOO_LARGE_BODY, 413)
      }

      // Kept BEFORE it is read, and that order is the decision.
      //
      // After would make keeping conditional on the model: a page refused as
      // several recipes, or a capture that failed, would lose its photograph —
      // and those are the photographs the invariant is for, since the scan-to-
      // shop measurement found two of its three refusals wrong and the pixels
      // are the only way to capture such a page again. Before also means a
      // store that cannot write refuses the submission before any model is
      // paid for, rather than after one was.
      //
      // A store that cannot write is this instance's fault, answered the way
      // every other one is below. Continuing without the photograph would
      // answer 201 for a capture whose scan the invariant says must exist.
      try {
        await deps.scanStore.put(body)
      } catch {
        return c.json({ error: "capture_failed" }, 500)
      }

      // After keeping, before reading. It passed the door on its label, so it is
      // a photograph this instance was sent and is kept like any other; what it
      // cannot be is read, since the provider does not take HEIF.
      if (isIsoBaseMediaFile(body)) {
        return c.json(HEIF_REFUSED_BODY, 415)
      }

      try {
        const result = await ingest(
          deps.repo,
          deps.capture,
          deps.normalization,
          deps.policy,
          body,
          {
            snapshotId: deps.identity.newSnapshotId(),
            snapshotVersion: 0,
            sourceAdapter: deps.sourceAdapter,
            adapterVersion: deps.adapterVersion,
            runId: deps.identity.newCaptureRunId(),
            sourceMediaType: mediaType,
            // A page the user held, which is what earns the vision path and its
            // verification exemption (ADR-0019) — the media type does not. Left
            // out, the provider fails closed to the text path and reads the
            // image's bytes as UTF-8: the model is handed mojibake, capture is
            // refused against it, and no photograph could ever be imported.
            sourceProvenance: "photo",
          },
          {
            runId: deps.identity.newNormalizationRunId(),
            targetOntologyVersion: deps.targetOntologyVersion,
          },
        )
        // The title travels twice, deliberately: as the declared state PDR-0005
        // made it, and as the sentence the phone shows. A source that gives no
        // title yields a sentence ABOUT that absence and no name at all — a
        // placeholder here would be a manufactured title again, one route further
        // out, and the person reading it could not tell the difference.
        const title = result.canonical.recipe.title
        // Built before the hook is called, so what is handed back cannot depend
        // on anything the hook does — and the hook's return value is discarded
        // rather than awaited, which is what keeps generation off this path.
        const response = c.json(
          {
            snapshotId: result.snapshot.id,
            recipeId: result.canonical.recipeId,
            version: result.canonical.version,
            title,
            message: importWording(title),
          },
          201,
        )
        deps.afterImport?.(result.canonical)
        return response
      } catch (error) {
        // The refusals a PERSON has to see, answered as themselves. Their fields
        // are copied off the error rather than restated, so a refusal that grows a
        // field does not quietly stop reaching the phone.
        if (error instanceof MultipleRecipesError) {
          return c.json(
            {
              reasonCode: error.reasonCode,
              recipeCount: error.recipeCount,
              recipeTitles: error.recipeTitles,
              message: refusalWording(error),
            },
            422,
          )
        }
        if (error instanceof UnknownRecipeCountError) {
          return c.json({ reasonCode: error.reasonCode, message: refusalWording(error) }, 422)
        }
        // Everything else is this instance's fault and says nothing further: a
        // stack or a message from inside would be the one place this endpoint
        // leaks what it knows to an unauthenticated-adjacent caller.
        return c.json({ error: "capture_failed" }, 500)
      }
    },
  )

  /**
   * `POST /capture/url` — import the recipe at a link, through the same spine.
   *
   * **Why this route exists at all, and it is not a feature request.** The URL
   * import was built, guarded and proved by CFV1-SL4, and then nothing in `src/`
   * ever called it: `importFromUrl` had no caller outside the test tree, so a
   * running instance had no address that could import a link. Every proof of the
   * import was true and none of them was about the instance — the same shape
   * CFV1-SERVE found when `createCookingApp` was built and never mounted. The
   * structural half of this unit, `serve/every-ingest-entry-point-is-reachable`,
   * is what makes that gap red instead of invisible.
   *
   * It sits in THIS app rather than an app of its own because the credential
   * decides the same one thing here as for a photograph — whether this
   * submission is the instance's to accept — and a second app would be a second
   * place that answer is given.
   *
   * **The guard's verdict is the answer, and nothing more of it than that.** A
   * refusal arrives as its `reasonCode` and a sentence built from the code
   * (`urlRefusalWording`). The `SafeFetchError`'s own message and its `url` are
   * deliberately NOT relayed: on a redirect refusal that URL is the address the
   * chain resolved to, and the message can name it too, so passing either back
   * would rebuild out here the resolver oracle ADR-0010 closes inside.
   */
  app.post(
    "/capture/url",
    // A link is small. This bound is about the SUBMISSION, not the page behind
    // it — the page's size bound belongs to the safe-fetch guard, which owns it
    // fail-closed and answers `SIZE_LIMIT`.
    bodyLimit({ maxSize: MAX_URL_SUBMISSION_BYTES, onError: (c) => c.json(TOO_LARGE_BODY, 413) }),
    async (c) => {
      if (!deps.credential.accepts(bearerCredential(c.req.header("authorization")))) {
        return c.json(UNAUTHORIZED_BODY, 401)
      }

      const mediaType =
        (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? ""
      if (mediaType !== URL_SUBMISSION_TYPE) {
        return c.json(
          {
            error: "unsupported_media_type",
            message: `this address accepts ${URL_SUBMISSION_TYPE}`,
          },
          415,
        )
      }

      // Parsed defensively: a body that is not an object, or carries no string
      // `url`, is the caller's mistake and is named as one. Handing an undefined
      // through to the guard would get a refusal with a reason about the URL,
      // which would be a true sentence about the wrong problem.
      let url: string
      try {
        const body: unknown = await c.req.json()
        const candidate =
          typeof body === "object" && body !== null && "url" in body
            ? (body as { url: unknown }).url
            : undefined
        if (typeof candidate !== "string" || candidate.trim() === "") {
          return c.json(MISSING_URL_BODY, 400)
        }
        url = candidate.trim()
      } catch {
        return c.json(MISSING_URL_BODY, 400)
      }

      try {
        const result = await importFromUrl(
          {
            byteSource: deps.byteSource,
            repo: deps.repo,
            // `urlCapture`, not `capture`: the URL path reads a page's own
            // structured data first and reaches the model only for a page whose
            // data is missing or unusable. Passing `capture` here is what made
            // the deterministic reader unreachable, and it is the one line the
            // structural guard reads.
            capture: deps.urlCapture,
            normalization: deps.normalization,
            policy: deps.policy,
          },
          url,
          {
            snapshotId: deps.identity.newSnapshotId(),
            snapshotVersion: 0,
            sourceAdapter: deps.urlSourceAdapter,
            adapterVersion: deps.urlAdapterVersion,
            runId: deps.identity.newCaptureRunId(),
            // Someone else's words, so the model-backed provider verifies
            // against them rather than taking the vision exemption a
            // photographed page earns (ADR-0019). Stated here because the
            // default is to fail closed on an ABSENT provenance, which would be
            // the same behaviour for the wrong reason — and because a URL that
            // happens to serve `image/*` is still not a page the user held.
            sourceProvenance: "url",
          },
          {
            runId: deps.identity.newNormalizationRunId(),
            targetOntologyVersion: deps.targetOntologyVersion,
          },
        )
        const title = result.canonical.recipe.title
        const response = c.json(
          {
            snapshotId: result.snapshot.id,
            recipeId: result.canonical.recipeId,
            version: result.canonical.version,
            title,
            message: importWording(title),
          },
          201,
        )
        deps.afterImport?.(result.canonical)
        return response
      } catch (error) {
        if (error instanceof SafeFetchError) {
          return c.json(
            { reasonCode: error.reasonCode, message: urlRefusalWording(error.reasonCode) },
            422,
          )
        }
        // The two refusals a person has to see reach this route too: a linked
        // page can hold several recipes exactly as a photographed page can.
        if (error instanceof MultipleRecipesError) {
          return c.json(
            {
              reasonCode: error.reasonCode,
              recipeCount: error.recipeCount,
              recipeTitles: error.recipeTitles,
              message: refusalWording(error),
            },
            422,
          )
        }
        if (error instanceof UnknownRecipeCountError) {
          return c.json({ reasonCode: error.reasonCode, message: refusalWording(error) }, 422)
        }
        return c.json({ error: "capture_failed" }, 500)
      }
    },
  )

  return app
}
