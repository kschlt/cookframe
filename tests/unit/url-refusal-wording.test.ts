/**
 * unit/a-url-refusal-says-what-was-refused — the words a person gets when a link
 * is not imported.
 *
 * Two properties, and they pull against each other on purpose.
 *
 * **Every reason has words.** The map in `capture-wording.ts` is typed
 * exhaustively over `ReasonCode` minus `OK`, and `tsc` does object to a missing
 * key — measured on 2026-09-22, deleting `CGNAT` produced `TS2741`. That is not
 * enough on its own: a later `Partial<>` would silence the compiler and leave a
 * refusal arriving as `undefined`, and this repository has already shipped one
 * claim that rested on `tsc` being loud where it was not. So the coverage is
 * asserted at run time, over the enum itself rather than over a list written
 * here — a list would be a second place to update and the first thing to go
 * stale.
 *
 * **The seven address reasons share ONE sentence, and the others do not.** The
 * collapse is the security property: which range a host resolved into is what
 * the guard learned and the caller did not (ADR-0010), so the sentence must not
 * distinguish them. Everything else must, or a refusal stops telling anyone what
 * to change — a scheme problem answered with the address sentence is true and
 * useless.
 */
import { describe, expect, it } from "vitest"
import { urlRefusalWording } from "../../src/http/capture-wording.js"
import { ReasonCode } from "../../src/security/reason-codes.js"

/** The seven that must be indistinguishable, and why each is one of them. */
const ADDRESS_REASONS: readonly ReasonCode[] = [
  ReasonCode.UNPARSEABLE_ADDRESS,
  ReasonCode.LOOPBACK,
  ReasonCode.LINK_LOCAL,
  ReasonCode.PRIVATE_RANGE,
  ReasonCode.CGNAT,
  ReasonCode.UNIQUE_LOCAL,
  ReasonCode.NON_UNICAST,
]

const everyReason = Object.values(ReasonCode).filter((code) => code !== ReasonCode.OK)

describe("unit/a-url-refusal-says-what-was-refused", () => {
  it("has words for every reason the guard can give, read off the enum itself", () => {
    // The floor: a filter that produced nothing would make every assertion
    // below vacuous, which is how a no-op passes a loop.
    expect(everyReason.length).toBeGreaterThan(10)
    for (const code of everyReason) {
      const words = urlRefusalWording(code)
      expect(words, code).toContain("This link was not imported:")
      expect(words.replace("This link was not imported:", "").trim(), code).not.toBe("")
      expect(words, code).not.toContain("undefined")
    }
  })

  it("gives the seven address reasons one sentence, so none of them names a range", () => {
    const sentences = new Set(ADDRESS_REASONS.map((code) => urlRefusalWording(code)))
    expect(sentences.size).toBe(1)
    for (const code of ADDRESS_REASONS) {
      // The code is the refusal's identity and travels; the SENTENCE must not
      // carry it, or the collapse is undone by the words beside it.
      expect(urlRefusalWording(code).toUpperCase()).not.toContain(code)
    }
  })

  it("gives every other reason words of its own, so a refusal says what to change", () => {
    const others = everyReason.filter((code) => !ADDRESS_REASONS.includes(code))
    // Six reasons that are not about an address, each with its own sentence.
    // Without this the whole map could collapse to one string and the property
    // above would still hold — the second half is what makes the first mean
    // something.
    expect(others.length).toBe(everyReason.length - ADDRESS_REASONS.length)
    expect(new Set(others.map(urlRefusalWording)).size).toBe(others.length)
    const addressSentence = urlRefusalWording(ReasonCode.LOOPBACK)
    for (const code of others) {
      expect(urlRefusalWording(code), code).not.toBe(addressSentence)
    }
  })

  it("says a refusal without a reason is this instance's fault, not the person's", () => {
    // `OK` reaching here would mean a successful fetch answered as a failure.
    // Inventing a cause for the person would be the worst available answer.
    expect(urlRefusalWording(ReasonCode.OK)).toContain("a fault here")
  })
})
