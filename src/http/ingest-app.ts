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
 *    whether this submission is accepted (`ingest-credential.ts`). There is no
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
import type { RecipeRepository } from "../persistence/index.js"
import type { BlockIdPolicy } from "../pipeline/block-id-policy.js"
import { ingest } from "../pipeline/ingest.js"
import type { CaptureProvider, NormalizationProvider } from "../pipeline/providers.js"
import { MultipleRecipesError, UnknownRecipeCountError } from "../pipeline/recipe-inventory.js"
import { importWording, refusalWording } from "./capture-wording.js"
import type { IngestCredential } from "./ingest-credential.js"
import { bearerCredential } from "./ingest-credential.js"

/**
 * What the phone may submit.
 *
 * An allowlist, not a denylist: an unrecognised type is refused rather than
 * handed to a capture provider that would have to guess. HEIC and HEIF are here
 * because that is what an iPhone produces by default, and a Shortcut that has to
 * convert first is friction on the journey this slice exists to measure.
 */
export const ACCEPTED_CAPTURE_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
]

/**
 * The largest submission accepted, in bytes.
 *
 * A bound rather than a hope. It is generous next to a phone photograph (a 12 MP
 * HEIC is a few megabytes) and small enough that an unbounded body cannot be
 * used to exhaust a self-hosted instance's memory. Exceeding it aborts the
 * submission; nothing is captured, stored or normalized from a truncated image,
 * because a truncated page is exactly the silent-loss shape this product refuses.
 */
export const MAX_CAPTURE_BYTES = 25 * 1024 * 1024

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
  readonly credential: IngestCredential
  readonly repo: RecipeRepository
  readonly capture: CaptureProvider
  readonly normalization: NormalizationProvider
  readonly policy: BlockIdPolicy
  readonly identity: IngestIdentity
  /** The ontology version a normalization run targets. */
  readonly targetOntologyVersion: string
  /** How this entry point names itself in `captureProvenance`. */
  readonly sourceAdapter: string
  readonly adapterVersion: string
}

/** The one unauthorized response. Identical for absent and for wrong. */
const UNAUTHORIZED_BODY = { error: "unauthorized" } as const

/**
 * Build the mobile ingest app. `POST /capture` takes the image bytes as the
 * request body, authenticated with the instance-scoped ingest credential as a
 * bearer token, and answers with the persisted recipe's identity — or with the
 * refusal, as itself.
 */
export function createIngestApp(deps: IngestAppDeps): Hono {
  const app = new Hono()

  app.post("/capture", async (c) => {
    // Absent and wrong are ONE answer. Two would tell someone probing whether a
    // credential exists at all, which is the same oracle the capability route
    // closes for tokens (ADR-0016, ADR-0021).
    if (!deps.credential.accepts(bearerCredential(c.req.header("authorization")))) {
      return c.json(UNAUTHORIZED_BODY, 401)
    }

    // The media type is what the caller knows and the provider cannot reliably
    // infer; it decides the capture provider's vision path. Parameters (`;
    // charset=…`) are stripped before matching, never matched with them.
    const mediaType = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? ""
    if (!ACCEPTED_CAPTURE_TYPES.includes(mediaType)) {
      return c.json(
        {
          error: "unsupported_media_type",
          message: `this instance accepts ${ACCEPTED_CAPTURE_TYPES.join(", ")}`,
        },
        415,
      )
    }

    const body = new Uint8Array(await c.req.arrayBuffer())
    if (body.byteLength === 0) {
      return c.json({ error: "empty_capture", message: "the submission carried no image" }, 400)
    }
    if (body.byteLength > MAX_CAPTURE_BYTES) {
      return c.json(
        {
          error: "capture_too_large",
          message: `this instance accepts at most ${MAX_CAPTURE_BYTES} bytes`,
        },
        413,
      )
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
      return c.json(
        {
          snapshotId: result.snapshot.id,
          recipeId: result.canonical.recipeId,
          version: result.canonical.version,
          title,
          message: importWording(title),
        },
        201,
      )
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
  })

  return app
}
