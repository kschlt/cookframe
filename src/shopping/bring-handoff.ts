/**
 * The Bring handoff: the one address that starts an import (CFV1-SHOP, ADR-0017).
 *
 * ADR-0017 fixed the mechanism as a **server-side pull** — Bring imports a recipe
 * by opening a deep link whose payload calls
 * `https://api.getbring.com/rest/bringrecipes/parser?url=<recipe url>`, and that
 * endpoint fetches `<recipe url>` from Bring's own infrastructure and parses the
 * Schema.org/Recipe JSON-LD it finds. There is no push API, no partner
 * credential and no OAuth, so this module holds no secret and makes no call:
 * building the link IS the integration, and the whole of it.
 *
 * The endpoint is observed rather than documented. `spikes/bring-compat/` drove
 * real imports through it and pinned the parse in `fixtures/`; the shape below is
 * that recording, not a reading of a Bring API document. That is also why it is a
 * constant in one place — if Bring moves it, exactly one line in this repository
 * is wrong, and it is this one.
 *
 * The recipe URL is percent-encoded as a query parameter. It carries a capability
 * token (ADR-0016), which is base64url and therefore free of characters that need
 * escaping — but the base URL in front of it is the operator's and is not, so the
 * encoding is done rather than assumed. Note the asymmetry it preserves: the
 * secret sits in the recipe URL's own PATH (ADR-0016, spike Q6 — a query token's
 * survival through Bring is host-dependent), and it is only this outer, Bring-side
 * link that carries that whole address as a query parameter.
 */

/** The parser endpoint the import deep link calls; observed, see `spikes/bring-compat/`. */
export const BRING_IMPORT_ENDPOINT = "https://api.getbring.com/rest/bringrecipes/parser"

/**
 * The import link for a recipe served at `recipeUrl` — what the operator opens to
 * hand that one recipe to Bring.
 *
 * Nothing about this call reaches Bring: it is string construction, so the
 * handoff is exercisable without a network and without an account.
 */
export function bringImportUrl(recipeUrl: string): string {
  return `${BRING_IMPORT_ENDPOINT}?url=${encodeURIComponent(recipeUrl)}`
}
