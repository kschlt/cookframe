/**
 * CFV1-SCC — the Shortcut's refusal branch must be a condition iOS accepts, on a key that
 * separates a refusal from an import.
 *
 * The first phone run showed an empty `If` ("Choose a value for every parameter"): the
 * definition encoded `WFCondition` as the number 100. Both branches also read `message`, which
 * the endpoint sends on success and on refusal alike; only `reasonCode` is refusal-only.
 * That the signed file runs on a device stays `OQ-38`.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { type PlistValue, parsePlist } from "./plist.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const definition = parsePlist(
  readFileSync(join(repoRoot, "shortcut", "Capture Recipe.plist"), "utf8"),
) as Record<string, PlistValue>
type Action = Record<string, PlistValue>
const actions = definition["WFWorkflowActions"] as readonly Action[]
const params = (a: Action) => a["WFWorkflowActionParameters"] as Record<string, PlistValue>
const named = (id: string) => actions.filter((a) => a["WFWorkflowActionIdentifier"] === id)
const lookups = named("is.workflow.actions.getvalueforkey")

describe("slice5/shortcut-condition-is-a-named-condition", () => {
  it("encodes no WFCondition as a number", () => {
    const conditions = named("is.workflow.actions.conditional")
      .map((a) => params(a)["WFCondition"])
      .filter((c) => c !== undefined)
    expect(conditions.length).toBeGreaterThan(0)
    for (const c of conditions) expect(typeof c).toBe("string")
    expect(conditions).toContain("Has Any Value")
  })
})

describe("slice5/shortcut-branches-on-reason-code", () => {
  const byName = (n: string) => lookups.find((a) => params(a)["CustomOutputName"] === n)
  it("tests the value read from reasonCode", () => {
    const refusal = byName("Reason")
    expect(refusal && params(refusal)["WFDictionaryKey"]).toBe("reasonCode")
    const ifAction = named("is.workflow.actions.conditional").find(
      (a) => params(a)["WFControlFlowMode"] === 0,
    )
    const input = JSON.stringify(ifAction && params(ifAction)["WFInput"])
    expect(input).toContain(String(refusal && params(refusal)["UUID"]))
  })
  it("shows the endpoint's message in both alerts", () => {
    const keys = lookups
      .filter((a) => params(a)["CustomOutputName"] !== "Reason")
      .map((a) => params(a)["WFDictionaryKey"])
    expect(keys).toEqual(["message", "message"])
  })
})

describe("slice5/shortcut-readme-says-how-to-sign", () => {
  it("names the signing step before the transfer", () => {
    const readme = readFileSync(join(repoRoot, "shortcut", "README.md"), "utf8")
    const sign = readme.indexOf("shortcuts sign --mode anyone")
    expect(sign).toBeGreaterThan(-1)
    expect(sign).toBeLessThan(readme.indexOf("Transfer"))
  })
})

describe("slice5/shortcut-strips-a-trailing-slash-from-the-instance", () => {
  it("builds the request address from the cleaned instance, not the entered text", () => {
    const entered = actions.find((a) => params(a)["CustomOutputName"] === "Entered address")
    const cleaned = named("is.workflow.actions.text.replace").find(
      (a) => params(a)["CustomOutputName"] === "Instance",
    )
    expect(cleaned && params(cleaned)["WFReplaceTextFind"]).toBe("/+$")
    expect(cleaned && params(cleaned)["WFReplaceTextReplace"]).toBe("")
    expect(cleaned && JSON.stringify(params(cleaned)["WFInput"])).toContain(
      String(entered && params(entered)["UUID"]),
    )
    const request = named("is.workflow.actions.downloadurl")[0]
    expect(JSON.stringify(request && params(request)["WFURL"])).toContain(
      String(cleaned && params(cleaned)["UUID"]),
    )
  })
})
