/**
 * CFV1-DBQ — the one check standing between a caller and an injected SQL
 * identifier.
 *
 * `set search_path to <shape>` cannot use a bound parameter: PostgreSQL takes
 * an identifier there, not a value, so every such statement in this spike
 * interpolates. What made that safe was supposed to be a guard on the shape
 * name — but the guard asked whether a SQL constant had a KEY of that name,
 * which is a different question from whether the name is a shape. A plain
 * object inherits five, so `constructor`, `toString`, `valueOf`,
 * `hasOwnProperty` and `__proto__` all passed it and were interpolated, each
 * also yielding a function where SQL was expected.
 *
 * Not reachable today — every caller passes a `SHAPES` constant — which is
 * exactly why it needed a test rather than a reader noticing. The check is now
 * membership in the declared list, and these are the cases that distinguish the
 * two questions. No database: it is a pure function, and a guard that only runs
 * when someone has PostgreSQL is a guard that mostly does not run.
 */
import { describe, expect, it } from "vitest"
import { assertShape, SHAPES } from "../../spikes/dbq/db.js"
import { LIBRARY_SQL } from "../../spikes/dbq/stores.js"

describe("dbq/shape-names-are-checked-against-the-contract", () => {
  it("accepts every declared shape, and returns it unchanged", () => {
    expect(SHAPES.length, "the shape list is empty, so this proves nothing").toBeGreaterThan(0)
    for (const shape of SHAPES) expect(assertShape(shape)).toBe(shape)
  })

  // The inherited keys, named one by one. These are the cases the old guard let
  // through, so they are the cases that prove the new one asks a different
  // question — not a generic "rejects rubbish" check.
  const inherited = ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]

  it("rejects the inherited object keys that a property lookup accepts", () => {
    for (const key of inherited) {
      // First: the old guard's question really does say yes to these, so the
      // case is live rather than hypothetical.
      expect(
        (LIBRARY_SQL as Record<string, unknown>)[key],
        `${key} no longer passes a property lookup, so this case has gone stale`,
      ).not.toBeUndefined()
      // And the real guard says no.
      expect(() => assertShape(key), `${key} reached SQL interpolation`).toThrow(
        /not a known shape/,
      )
    }
  })

  it("rejects a name carrying SQL, so an identifier cannot smuggle a statement", () => {
    for (const bad of [
      "document; drop schema public cascade --",
      "public",
      "",
      "DOCUMENT",
      " document",
    ]) {
      expect(() => assertShape(bad), `${JSON.stringify(bad)} was accepted`).toThrow(
        /not a known shape/,
      )
    }
  })

  it("names what it expected, so a caller can see why it was refused", () => {
    expect(() => assertShape("nope")).toThrow(/expected one of/)
  })
})
