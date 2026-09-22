/**
 * The OpenAI implementation of {@link ModelTransport}.
 *
 * ADR-0004 keeps provider types, SDK types and model identifiers out of the
 * application: the capabilities in `model-providers.ts` name no vendor and run
 * their stage through an injected transport. **This file is the implementation
 * that boundary exists to contain** — it is the one place in `src/` allowed to
 * know what an OpenAI chat request looks like, and nothing imports it except the
 * composition that wires an instance together.
 *
 * It opens no socket of its own. Every byte leaves through
 * `src/security/model-egress.ts`, which fixes the endpoint, refuses a redirect
 * rather than forwarding the credential, bounds the call in time and size, and
 * keeps the credential out of anything it emits. That is what lets the ADR-0010
 * chokepoint test stand unchanged with this file in the tree: all egress is
 * still opened inside `src/security/`.
 *
 * The model id is a constructor argument and never a default, so a run always
 * records what it actually used rather than what it assumed.
 */
import { createModelEndpoint } from "../security/model-egress.js"
import type { ModelExchange, ModelReply, ModelTransport } from "./providers.js"

/** The provider's chat endpoint. Operator configuration, never derived from content. */
const OPENAI_CHAT_ENDPOINT = "https://api.openai.com/v1/chat/completions"

/**
 * The image formats the provider reads, as its vision guide lists them: PNG,
 * JPEG, WEBP and non-animated GIF
 * (https://developers.openai.com/api/docs/guides/images-vision, read
 * 2026-09-22). HEIC and HEIF are not among them; the provider's own error for
 * one is reported as "unsupported image", though no request carrying one has
 * been sent from here to see it. So an image in any other format is refused
 * here, before the request is sent, rather than learned about from the vendor
 * after the call was made.
 */
export const OPENAI_IMAGE_MEDIA_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]

/** An image part in a format the provider does not read, refused before sending. */
export class UnsupportedImageMediaTypeError extends Error {
  constructor(readonly mediaType: string) {
    super(`the model provider does not read ${mediaType} images`)
    this.name = "UnsupportedImageMediaTypeError"
  }
}

export interface OpenAITransportOptions {
  readonly apiKey: string
  readonly model: string
  /** Vision detail level; "high" tiles the image rather than downsampling it. */
  readonly imageDetail?: "low" | "high" | "auto"
  /** Override the endpoint. For tests and provider-compatible gateways only. */
  readonly endpoint?: string
  /** Whole-call deadline, passed through to the egress guard. */
  readonly timeoutMs?: number
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64")
}

/** Render the exchange's parts as OpenAI chat content items. */
function toContent(exchange: ModelExchange, detail: "low" | "high" | "auto") {
  return exchange.parts.map((part) =>
    part.kind === "text"
      ? { type: "text" as const, text: part.text }
      : {
          type: "image_url" as const,
          image_url: {
            url: `data:${part.mediaType};base64,${toBase64(part.bytes)}`,
            detail,
          },
        },
  )
}

export function createOpenAITransport(options: OpenAITransportOptions): ModelTransport {
  const detail = options.imageDetail ?? "high"
  const send = createModelEndpoint({
    endpoint: options.endpoint ?? OPENAI_CHAT_ENDPOINT,
    credential: options.apiKey,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  })

  return {
    async send(exchange): Promise<ModelReply> {
      for (const part of exchange.parts) {
        if (part.kind === "image" && !OPENAI_IMAGE_MEDIA_TYPES.includes(part.mediaType)) {
          throw new UnsupportedImageMediaTypeError(part.mediaType)
        }
      }
      const { json, latencyMs } = await send({
        model: options.model,
        messages: [
          { role: "system", content: exchange.system },
          { role: "user", content: toContent(exchange, detail) },
        ],
        ...(exchange.jsonOnly ? { response_format: { type: "json_object" } } : {}),
      })
      const parsed = json as ChatResponse
      const text = parsed.choices?.[0]?.message?.content
      if (typeof text !== "string" || text.length === 0) {
        throw new Error("model endpoint returned no message content")
      }
      const inputTokens = parsed.usage?.prompt_tokens
      const outputTokens = parsed.usage?.completion_tokens
      return {
        text,
        latencyMs,
        usage: {
          ...(inputTokens !== undefined ? { inputTokens } : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {}),
        },
      }
    },
  }
}
