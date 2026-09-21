/**
 * An OpenAI-backed {@link ModelTransport} for the CFV1-S1 real-photo run.
 *
 * **This file is deliberately in `spikes/`, and that is a decision deferred, not
 * a decision made.** The product's capture and normalization capabilities
 * (`src/pipeline/model-providers.ts`) are complete and provider-agnostic; what is
 * missing from the product is a *transport*, and a transport has to open a
 * socket. `ADR-0010` put the one network chokepoint in `src/security/` — but its
 * subject is URL *ingestion*: fetching attacker-influenced addresses, where the
 * threat is SSRF and the mechanism is a default-deny address policy. Egress to a
 * fixed, configured, first-party API endpoint is a different shape, and which of
 * these it is has not been decided:
 *
 *   a. extend `safe-fetch` to carry method/headers/body, so there stays exactly
 *      one egress function (most faithful to ADR-0010 point 1, but it widens a
 *      module that had its own security review);
 *   b. add a second module inside `src/security/`, so "all egress lives in one
 *      directory" holds and the chokepoint test still passes as written;
 *   c. record that model egress is out of ADR-0010's scope and give it its own
 *      guard.
 *
 * Each sets a permanent contract, so the choice is the maintainer's. Until it is
 * made, this transport lives here — outside the `src/` tree the chokepoint test
 * scans, exactly as `spikes/s6-fidelity/openai-run.ts` already does — so the real
 * photo run can happen without pre-empting the decision.
 *
 * Requires OPENAI_API_KEY. The model id is a constructor argument, never a
 * default, so a run always records what it actually used.
 */
import type {
  ModelExchange,
  ModelReply,
  ModelTransport,
} from "../../src/pipeline/providers.js"

export interface OpenAITransportOptions {
  readonly apiKey: string
  readonly model: string
  /** Vision detail level; "high" tiles the image rather than downsampling it. */
  readonly imageDetail?: "low" | "high" | "auto"
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
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
  return {
    async send(exchange): Promise<ModelReply> {
      const started = Date.now()
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: "system", content: exchange.system },
            { role: "user", content: toContent(exchange, detail) },
          ],
          ...(exchange.jsonOnly ? { response_format: { type: "json_object" } } : {}),
        }),
      })
      const latencyMs = Date.now() - started
      const json = (await res.json()) as ChatResponse
      if (!res.ok || json.error) {
        throw new Error(`OpenAI ${res.status}: ${json.error?.message ?? "unknown error"}`)
      }
      const text = json.choices?.[0]?.message?.content
      if (!text) throw new Error("OpenAI returned no message content")
      return {
        text,
        latencyMs,
        usage: {
          inputTokens: json.usage?.prompt_tokens,
          outputTokens: json.usage?.completion_tokens,
        },
      }
    },
  }
}
