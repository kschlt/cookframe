/**
 * CFV1-SL5 — the committed Shortcut definition, and what it must not carry.
 *
 * `PDR-0003` makes `shortcut/Capture Recipe.plist` the source of truth for the
 * product's mobile client, on the argument that a client arriving by pull
 * request is auditable and a prebuilt share link is not. That argument only pays
 * if something actually audits it, which is this file.
 *
 * What it can prove and what it cannot are different things, and the difference
 * is registered rather than blurred. It proves the file is a readable property
 * list, that it carries neither a credential nor an identifier of anyone's
 * instance, and that the one place it reaches the network is the instance the
 * importer named. It does NOT prove Shortcuts accepts it: no iOS device is
 * reachable from here, so that is `OQ-38`, open.
 *
 * The clean-file scan reads the file's BYTES as well as its parsed strings. A
 * secret pasted into a comment is still a committed secret, and the parser
 * deliberately throws comments away.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { MIN_INGEST_CREDENTIAL_LENGTH } from "../../src/http/ingest-credential.js"
import { allStrings, type PlistValue, parsePlist } from "./plist.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const shortcutPath = join(repoRoot, "shortcut", "Capture Recipe.plist")
const raw = readFileSync(shortcutPath, "utf8")

/**
 * Strings shaped like a credential.
 *
 * Not an entropy test: measured first, and English prose scores HIGHER than a
 * hex secret, so entropy would have flagged this file's own help text and
 * missed the thing it was looking for. What actually separates a credential
 * from everything else in a Shortcut is that it is a long run of one restricted
 * alphabet with no word structure — either mixed-case base64url, or hex.
 *
 * Checked against the two forms `shortcut/README.md` tells an operator to
 * generate, and against everything this file legitimately contains: the action
 * UUIDs are upper-case and hyphenated (no lower-case letter, so not the first
 * form; not hex, because of the hyphens), the placeholder is lower-case words,
 * and every URL and sentence carries characters outside both alphabets.
 */
function credentialShaped(value: string): boolean {
  if (value.length < MIN_INGEST_CREDENTIAL_LENGTH) return false
  if (/^[0-9a-fA-F]+$/.test(value)) return true
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false
  return /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value)
}

/** Every run of credential-alphabet characters in the raw bytes, comments included. */
const runsIn = (text: string): string[] => text.match(/[A-Za-z0-9_-]+/g) ?? []

/** The one line of this file that must name a host, and the only host it may name. */
const DOCTYPE =
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ' +
  '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">'

const definition = parsePlist(raw) as Record<string, PlistValue>
const actions = definition["WFWorkflowActions"] as readonly Record<string, PlistValue>[]
const questions = definition["WFWorkflowImportQuestions"] as readonly Record<string, PlistValue>[]

describe("slice5/shortcut-definition-committed-and-clean", () => {
  it("is committed, and is a property list this reader can read in full", () => {
    // The strict reader (proved in `plist.test.ts`) refuses anything it does not
    // fully understand, so "it parsed" is a statement about the whole document.
    expect(raw.length).toBeGreaterThan(0)
    expect(Array.isArray(actions), "the definition declares no actions").toBe(true)
    expect(actions.length).toBeGreaterThan(0)
  })

  it("carries no credential, in its values or in its comments", () => {
    const fromValues = allStrings(definition).flatMap(runsIn).filter(credentialShaped)
    const fromBytes = runsIn(raw).filter(credentialShaped)
    expect(fromValues, "a credential-shaped value is committed in this file").toEqual([])
    expect(fromBytes, "a credential-shaped string is committed in this file").toEqual([])
  })

  it("would catch a credential of either form an operator is told to generate", () => {
    // The scan above is only worth its line if it fires. Both forms
    // `shortcut/README.md` produces, and a plain guess, put through it here.
    expect(credentialShaped("Yk9sT3pQd3hLbU5iVmNYelJ0eXVJb3BB")).toBe(true)
    expect(credentialShaped("9f2c41ab77de0351cc8e4b12ff7a6d90")).toBe(true)
    // And what the file legitimately holds does not fire it, or the proof above
    // would be unsatisfiable and would have to be weakened to pass.
    expect(credentialShaped("3F1B0A2C-0001-4C6E-9A21-C0F3E1A40001")).toBe(false)
    expect(credentialShaped("paste-your-instance-ingest-credential-here")).toBe(false)
  })

  it("names no instance: every URL in it is in a domain reserved for examples", () => {
    // RFC 2606 reserves `example`, `.example`, `.test`, `.invalid`, `.localhost`.
    // Anything else is somebody's host, and a committed one is the identifier
    // PDR-0003 forbids — including in a comment, which is why this reads bytes.
    //
    // One carve-out, and it is pinned rather than waved through: the DOCTYPE
    // the property-list format requires names Apple's DTD, so that line is
    // asserted to be EXACTLY the standard one and then removed. A modified
    // DOCTYPE cannot smuggle a host past this, because it would no longer match.
    expect(raw).toContain(DOCTYPE)
    // `)` is excluded and trailing punctuation trimmed, because these URLs also
    // appear inside prose ("… (for example https://cookframe.example)").
    const urls = (raw.replace(DOCTYPE, "").match(/https?:\/\/[^\s"'<>)]+/g) ?? []).map((u) =>
      u.replace(/[.,;:]+$/, ""),
    )
    expect(urls.length, "the file shows no example URL at all").toBeGreaterThan(0)
    for (const url of urls) {
      const host = new URL(url).hostname
      expect(
        /(^|\.)(example|test|invalid|localhost)$/.test(host),
        `\`${host}\` is a real host, so this file identifies an instance`,
      ).toBe(true)
    }
  })

  it("asks for both configurable values at import instead of carrying them", () => {
    // The mechanism that keeps the file clean. Each question is matched to the
    // action it fills BY INDEX, and the action it names is read from the file —
    // a question pointing at the wrong action would silently leave a placeholder
    // in place and send every capture to `cookframe.example`.
    expect(questions).toHaveLength(2)
    const filled = new Set<number>()
    for (const question of questions) {
      const index = question["ActionIndex"] as number
      const key = question["ParameterKey"] as string
      const action = actions[index]
      expect(action, `question points at action ${index}, which does not exist`).toBeDefined()
      const parameters = action?.["WFWorkflowActionParameters"] as Record<string, PlistValue>
      expect(
        Object.hasOwn(parameters, key),
        `action ${index} has no \`${key}\` for the question to fill`,
      ).toBe(true)
      expect(question["DefaultValue"]).toBe(parameters[key])
      filled.add(index)
    }
    expect(filled.size, "two questions fill the same action").toBe(2)
  })

  it("has no editable text the import does not ask about", () => {
    // Every `gettext` action is a value the operator must supply. One that no
    // question covers is a placeholder the user never sees and never replaces.
    const textActions = actions
      .map((action, index) => ({ action, index }))
      .filter(
        ({ action }) => action["WFWorkflowActionIdentifier"] === "is.workflow.actions.gettext",
      )
    const asked = new Set(questions.map((q) => q["ActionIndex"] as number))
    for (const { index } of textActions) {
      expect(asked.has(index), `action ${index} holds text no import question fills`).toBe(true)
    }
    expect(textActions.length).toBe(questions.length)
  })
})

describe("slice5/no-client-reachable-model-credential", () => {
  it("reaches exactly one address, and it is the instance the importer named", () => {
    // The client's whole network surface, read off the definition. A model
    // provider's endpoint added here — or any second host — fails this before it
    // can be argued about.
    const requests = actions.filter(
      (a) => a["WFWorkflowActionIdentifier"] === "is.workflow.actions.downloadurl",
    )
    expect(requests, "the client makes no request at all").toHaveLength(1)

    const parameters = requests[0]?.["WFWorkflowActionParameters"] as Record<string, PlistValue>
    const url = parameters["WFURL"] as Record<string, PlistValue>
    const value = url["Value"] as Record<string, PlistValue>

    // The URL is COMPOSED from the instance the importer supplied — an attached
    // action output, not a literal — and the literal part is only the path.
    const attachments = value["attachmentsByRange"] as Record<string, PlistValue>
    const referenced = Object.values(attachments).map(
      (a) => (a as Record<string, PlistValue>)["OutputName"],
    )
    expect(referenced).toEqual(["Instance"])
    expect(value["string"]).not.toMatch(/https?:/)
    expect(value["string"]).toContain("/capture")
  })

  it("holds nothing that is a model credential or could be exchanged for one", () => {
    // The two values the client holds are the ones the import asks for, and the
    // questions say what they are for. Neither is a provider credential, and the
    // endpoint that accepts one of them offers no exchange (proved against the
    // shipped credential object in `mobile-entry-point.test.ts`).
    //
    // What is checked here is that nothing ELSE is held: no third stored value,
    // and no provider vocabulary anywhere in the file.
    const stored = actions.filter(
      (a) =>
        a["WFWorkflowActionIdentifier"] === "is.workflow.actions.gettext" ||
        a["WFWorkflowActionIdentifier"] === "is.workflow.actions.setvariable",
    )
    expect(stored).toHaveLength(2)
    expect(raw).not.toMatch(/api[_-]?key|sk-[A-Za-z0-9]|openai|anthropic|bearer sk/i)
  })

  it("sends the credential it holds to the instance, and to nothing else", () => {
    // A header carrying the credential on a request to anywhere but the
    // instance would be the leak this criterion is about. There is one request,
    // proved above; this checks what it carries.
    const request = actions.find(
      (a) => a["WFWorkflowActionIdentifier"] === "is.workflow.actions.downloadurl",
    )
    const parameters = request?.["WFWorkflowActionParameters"] as Record<string, PlistValue>
    const headers = parameters["WFHTTPHeaders"] as Record<string, PlistValue>
    const carried = JSON.stringify(headers)
    expect(carried).toContain("Credential")
    expect(carried).toContain("Authorization")
    // And the credential is not also pasted anywhere as a literal.
    expect(runsIn(carried).filter(credentialShaped)).toEqual([])
  })
})
