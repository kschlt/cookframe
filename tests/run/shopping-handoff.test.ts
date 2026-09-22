/**
 * CFV1-SHOP — a recipe can be handed to Bring from a running instance, and the
 * handoff can be taken back.
 *
 * Each `describe` string is the acceptance-criterion proof id it satisfies.
 *
 * The measured failure: ADR-0016 and ADR-0017 were built and proved, and a
 * running instance could not do what they describe. Measured against `287514f`,
 * `CapabilityStore.issue` and `CapabilityStore.revoke` had no caller anywhere in
 * `src/` — the serving route resolved tokens nobody could mint, and the kill
 * switch ADR-0016 calls "the token's only end" had nothing on the far side of
 * it. Thirty-odd proofs drove the store and the route, and every one of them
 * minted its own token by calling `issue` directly. That is this repository's
 * fourth recurring shape — a proof that builds its own subject shows the code
 * works when called, never that anything calls it — and the URL import (#89)
 * was the same finding one address over.
 *
 * Three links close it, and each says what it cannot see:
 *
 *  1. **`shop/every-capability-operation-is-called-from-the-http-layer`** reads
 *     the tree: every operation the `CapabilityStore` interface declares is
 *     CALLED somewhere under `src/http/`. A call, not a mention — `void
 *     store.issue` would leave the tree exactly as dark as it was with the name
 *     still in it. It cannot see what the call is made ON: the scan is
 *     syntactic, so an unrelated object's `.revoke(…)` in the HTTP layer would
 *     satisfy it. That is why it does not stand alone.
 *  2. **`serve/an app nobody mounts serves nothing`** (`mounted-apps.test.ts`,
 *     already on `main`) holds that every app factory in `src/http/` is routed
 *     by the composition root, so a call inside one is a call inside something
 *     the instance serves.
 *  3. **`run/a-recipe-can-be-handed-to-bring-from-a-running-instance`** closes
 *     both gaps over a real socket: it mints through the address, fetches the
 *     URL it was handed with no credential, as Bring does, and revokes it —
 *     against the one store the serving route resolves from.
 *
 * **Why the structural guard needs a precision table, and which half of it.**
 * ADR-0029: a guard's breadth is held only by an assertion that names a member.
 * The guard's own assertion is a PRESENCE — every declared operation must be
 * found — so narrowing the file walk, or the recognised call spellings, can only
 * turn it red: fewer calls found is a failure, not a pass. That half holds its
 * own breadth. The other half does not. If the reading of the interface returned
 * FEWER operations, fewer would be required and the guard would pass over a
 * tree it no longer checks, which is why `names the operations the interface
 * declares` spells all three. And if the call reading widened — a mention
 * counted as a call — the guard would pass for a reason the tree does not have,
 * which is what the spare half of the table is for.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { afterEach, describe, expect, it } from "vitest"
import { NOT_FOUND_BODY, NOT_FOUND_STATUS } from "../../src/http/not-found.js"
import { createProvisionalStore } from "../../src/persistence/index.js"
import { BRING_IMPORT_ENDPOINT, bringImportUrl } from "../../src/shopping/bring-handoff.js"
import {
  type CapabilityStore,
  capabilityUrl,
  createCapabilityStore,
} from "../../src/shopping/capability-token.js"
import { filesUnder, SOURCE_EXTENSIONS } from "../support/tree.js"
import {
  captureBody,
  INGEST_CREDENTIAL,
  LIBRARY_CREDENTIAL,
  shapeOf,
  startTestInstance,
  type TestInstance,
} from "./harness.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const httpDir = join(repoRoot, "src", "http")
const capabilityTokenFile = join(repoRoot, "src", "shopping", "capability-token.ts")

/** The interface whose every operation the HTTP layer has to reach. */
const STORE_INTERFACE = "CapabilityStore"

/** Parse source TEXT; every rule below decides on text, so a fixture is a string. */
function parseText(source: string): ts.SourceFile {
  return ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true)
}

/** A member's name when it is written as an identifier or a string literal. */
function memberName(name: ts.PropertyName | undefined): string | undefined {
  if (name === undefined) return undefined
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  return undefined
}

/**
 * The operations an interface named {@link STORE_INTERFACE} declares, sorted.
 *
 * An operation is a method signature, or a property whose type is a function —
 * the two ways TypeScript spells the same member, and a style choice rather than
 * a difference in what the store offers. A property that is not a function is
 * data, and is not an operation anything has to call.
 */
function declaredOperations(source: string): string[] {
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === STORE_INTERFACE) {
      for (const member of node.members) {
        const name = memberName(member.name)
        if (name === undefined) continue
        if (ts.isMethodSignature(member)) out.push(name)
        else if (
          ts.isPropertySignature(member) &&
          member.type !== undefined &&
          ts.isFunctionTypeNode(member.type)
        ) {
          out.push(name)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(parseText(source))
  return out.sort()
}

/**
 * Which of `operations` this source CALLS as a method — `x.op(…)`, `x["op"](…)`,
 * and the optional-chaining and parenthesised forms of both.
 *
 * A call, and only a call. A reference (`const f = store.issue`), a `void`
 * expression, a comment and a string all name the operation and none of them
 * reaches it, and counting any of them would make this guard pass over exactly
 * the tree it was written against.
 *
 * **What it does not see, stated:** a bare call of a destructured method
 * (`const { issue } = store; issue(id)`). That is a real call this reads as
 * absent, so it fails CLOSED — the guard goes red over correct code and somebody
 * looks — rather than open. It also does not see what the call is made on; see
 * the file header for what covers that.
 */
function operationsCalledIn(source: string, operations: ReadonlySet<string>): Set<string> {
  const found = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      let callee: ts.Expression = node.expression
      while (ts.isParenthesizedExpression(callee)) callee = callee.expression
      let name: string | undefined
      if (ts.isPropertyAccessExpression(callee)) name = callee.name.text
      else if (
        ts.isElementAccessExpression(callee) &&
        ts.isStringLiteralLike(callee.argumentExpression)
      ) {
        name = callee.argumentExpression.text
      }
      if (name !== undefined && operations.has(name)) found.add(name)
    }
    ts.forEachChild(node, visit)
  }
  visit(parseText(source))
  return found
}

describe("shop/every-capability-operation-is-called-from-the-http-layer", () => {
  it("names the operations the interface declares", () => {
    // Spelled out, because this is the half of the guard a narrowing would pass:
    // an interface reading that found only `resolve` would require only
    // `resolve`, which the serving route has always called. A fourth operation
    // added to the store turns this red too, which is correct — it is a fourth
    // thing an instance has to be able to reach, and somebody has to say how.
    expect(declaredOperations(readFileSync(capabilityTokenFile, "utf8"))).toEqual([
      "issue",
      "resolve",
      "revoke",
    ])
  })

  it("finds a call to every one of them under src/http/", () => {
    const declared = new Set(declaredOperations(readFileSync(capabilityTokenFile, "utf8")))
    const files = filesUnder(httpDir, { match: SOURCE_EXTENSIONS })
    expect(files.length, "the walk read nothing under src/http/").toBeGreaterThan(0)

    const called = new Set<string>()
    for (const file of files) {
      for (const op of operationsCalledIn(readFileSync(file, "utf8"), declared)) called.add(op)
    }
    const uncalled = [...declared].filter((op) => !called.has(op)).sort()
    expect(
      uncalled,
      `${STORE_INTERFACE} operations with no caller in src/http/ — a running instance cannot ` +
        "reach them, whatever their own proofs say",
    ).toEqual([])
  })
})

/** Sources the interface reading must see, and exactly what it must see in each. */
const DECLARED_MUST_SEE: readonly (readonly [string, string, readonly string[]])[] = [
  ["a method signature", "interface CapabilityStore { issue(id: string): Promise<G> }", ["issue"]],
  [
    "a function-typed property",
    "interface CapabilityStore { readonly revoke: (t: string) => Promise<boolean> }",
    ["revoke"],
  ],
  [
    "a string-literal name",
    'interface CapabilityStore { "resolve"(t: string): Promise<string | undefined> }',
    ["resolve"],
  ],
  [
    "an exported interface with all three",
    "export interface CapabilityStore { issue(a: string): P; resolve(t: string): P; revoke(t: string): P }",
    ["issue", "resolve", "revoke"],
  ],
]

/**
 * Sources that name something close and declare no operation. Each is here
 * because dropping one condition of the reading would count it:
 *
 *  - the data property dies if the function-type test is dropped;
 *  - the other interface dies if the interface-name test is dropped;
 *  - the class dies if any declaration called `CapabilityStore` is read, rather
 *    than the interface — an implementation's methods are not the contract.
 */
const DECLARED_MUST_SPARE: readonly (readonly [string, string])[] = [
  ["a data property", "interface CapabilityStore { readonly label: string }"],
  ["another interface's method", "interface Other { issue(id: string): void }"],
  [
    "an implementing class",
    "declare const CapabilityStore: unknown\nclass InMemory implements Foo { issue(id: string) {} }\nclass CapabilityStore { revoke(t: string) {} }",
  ],
]

const OPERATIONS: ReadonlySet<string> = new Set(["issue", "resolve", "revoke"])

/** Sources the call reading must count, and the operation each one calls. */
const CALL_MUST_SEE: readonly (readonly [string, string, string])[] = [
  ["a call through the deps", "await deps.capabilityStore.issue(id)", "issue"],
  ["a call on a local", "store.revoke(token)", "revoke"],
  ["a call by element access", 'store["resolve"](token)', "resolve"],
  ["an optional call", "store.issue?.(id)", "issue"],
  ["an optional receiver", "store?.revoke(token)", "revoke"],
  ["a parenthesised callee", "(store.issue)(id)", "issue"],
  ["a call split over lines", "deps.capabilityStore\n  .revoke(\n    token,\n  )", "revoke"],
]

/**
 * Sources that NAME an operation and call none. Each dies with one condition:
 *
 *  - the reference and the `void` die if a property access counts without a call
 *    around it — the exact form #89 measured passing its own first guard;
 *  - the comment and the string die if the reading becomes a text search;
 *  - `issued` dies if names are matched by prefix rather than exactly;
 *  - the bare call dies if an identifier callee counts, which would accept any
 *    function in the HTTP layer that happens to be called `issue`.
 */
const CALL_MUST_SPARE: readonly (readonly [string, string])[] = [
  ["a reference", "const mint = store.issue"],
  ["a void expression", "void store.revoke"],
  ["a comment", "// store.issue(id)\nconst x = 1"],
  ["a string", 'const s = "store.issue(id)"'],
  ["a longer name", "store.issued(id)"],
  ["a bare call", "issue(id)"],
]

describe("shop/the-capability-scan-is-precise", () => {
  it.each(DECLARED_MUST_SEE)("reads %s", (_, source, expected) => {
    expect(declaredOperations(source)).toEqual(expected)
  })

  it.each(DECLARED_MUST_SPARE)("declares nothing for %s", (_, source) => {
    expect(declaredOperations(source)).toEqual([])
  })

  it.each(CALL_MUST_SEE)("counts %s", (_, source, op) => {
    expect([...operationsCalledIn(source, OPERATIONS)]).toEqual([op])
  })

  it.each(CALL_MUST_SPARE)("does not count %s", (_, source) => {
    expect([...operationsCalledIn(source, OPERATIONS)]).toEqual([])
  })
})

describe("shop/the-handoff-links-are-built-from-the-configured-address", () => {
  const token = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

  it.each([
    ["https://cookframe.test", `https://cookframe.test/r/${token}`],
    // One slash, not two: both spellings of a base configure the same address.
    ["https://cookframe.test/", `https://cookframe.test/r/${token}`],
    ["https://cookframe.test///", `https://cookframe.test/r/${token}`],
    // The prefix of an instance behind a reverse proxy survives. `new URL`
    // resolution would have dropped it, silently, which is why it is not used.
    ["https://example.test/cookframe", `https://example.test/cookframe/r/${token}`],
    ["https://example.test/cookframe/", `https://example.test/cookframe/r/${token}`],
  ])("builds the capability URL on %j", (base, expected) => {
    expect(capabilityUrl(base, token)).toBe(expected)
  })

  it("puts the whole capability URL into Bring's query, encoded", () => {
    const url = "https://example.test/cook frame/r/abc"
    const link = bringImportUrl(url)
    expect(link.startsWith(`${BRING_IMPORT_ENDPOINT}?url=`)).toBe(true)
    // Read back the way Bring's server would read it, not compared as a string
    // this test also wrote: what matters is that the parameter decodes to the
    // address, whatever the base URL contained.
    expect(new URL(link).searchParams.get("url")).toBe(url)
    // And the space was not left raw, which a concatenation would have done.
    expect(link).not.toContain(" ")
  })
})

let running: TestInstance | undefined

afterEach(async () => {
  await running?.stop()
  running = undefined
})

/** A capability store that counts mints, so a refusal can be shown to mint nothing. */
function countingStore(): { store: CapabilityStore; issued: { count: number } } {
  const inner = createCapabilityStore(createProvisionalStore())
  const issued = { count: 0 }
  return {
    issued,
    store: {
      issue: async (recipeId) => {
        issued.count += 1
        return inner.issue(recipeId)
      },
      resolve: (token) => inner.resolve(token),
      revoke: (token) => inner.revoke(token),
    },
  }
}

/** Put one recipe into the instance through the ingest route, over the socket. */
async function captured(it_: TestInstance, title: string): Promise<string> {
  const res = await fetch(`${it_.origin}/capture`, {
    method: "POST",
    headers: { authorization: `Bearer ${INGEST_CREDENTIAL}`, "content-type": "image/jpeg" },
    body: captureBody(title),
  })
  expect(res.status, "the fixture capture was not accepted").toBe(201)
  return ((await res.json()) as { recipeId: string }).recipeId
}

const libraryAuth = { authorization: `Bearer ${LIBRARY_CREDENTIAL}` }

interface Shared {
  readonly recipeId: string
  readonly token: string
  readonly url: string
  readonly bringImport: string
}

/** Mint over the socket, as the operator would. */
async function share(it_: TestInstance, recipeId: string): Promise<Response> {
  return await fetch(`${it_.origin}/recipes/${recipeId}/share`, {
    method: "POST",
    headers: libraryAuth,
  })
}

describe("run/a-recipe-can-be-handed-to-bring-from-a-running-instance", () => {
  it("mints a URL that the instance serves to a caller holding nothing else", async () => {
    running = await startTestInstance({ servesItsOwnAddress: true })
    const it_ = running
    const recipeId = await captured(it_, "Sourdough Rye")

    const minted = await share(it_, recipeId)
    expect(minted.status).toBe(200)
    expect(minted.headers.get("content-type")).toMatch(/^application\/json/)
    // The body carries a live credential; nothing between here and the reader
    // may keep a copy of it (ADR-0016: revocation is the only end).
    expect(minted.headers.get("cache-control")).toBe("no-store")
    const shared = (await minted.json()) as Shared

    expect(shared.recipeId).toBe(recipeId)
    // Built on the CONFIGURED address, which for this instance is its real one.
    expect(shared.url).toBe(`${it_.origin}/r/${shared.token}`)
    expect(shared.bringImport).toBe(bringImportUrl(shared.url))

    // Fetched as Bring fetches it: server-side, with no credential of any kind.
    // A 200 here is the whole handoff — the page Bring parses.
    const fetched = await fetch(shared.url)
    expect(fetched.status).toBe(200)
    expect(fetched.headers.get("content-type")).toBe("application/ld+json")
    const recipe = (await fetched.json()) as { "@type": string; name?: string }
    expect(recipe["@type"]).toBe("Recipe")
    expect(recipe.name).toBe("Sourdough Rye")
  })

  it("mints a new URL each time, and each works on its own", async () => {
    // ADR-0016: the store maps a token to a recipe and never the reverse, so a
    // second share cannot hand back the first token — that would need the index
    // the record refuses to keep.
    running = await startTestInstance({ servesItsOwnAddress: true })
    const it_ = running
    const recipeId = await captured(it_, "Rye Crackers")

    const first = (await (await share(it_, recipeId)).json()) as Shared
    const second = (await (await share(it_, recipeId)).json()) as Shared

    expect(second.token).not.toBe(first.token)
    expect((await fetch(first.url)).status).toBe(200)
    expect((await fetch(second.url)).status).toBe(200)
  })

  it("takes a URL back, after which it is the same answer as one never issued", async () => {
    running = await startTestInstance({ servesItsOwnAddress: true })
    const it_ = running
    const recipeId = await captured(it_, "Seeded Loaf")
    const shared = (await (await share(it_, recipeId)).json()) as Shared
    expect((await fetch(shared.url)).status).toBe(200)

    const revoke = (): Promise<Response> =>
      fetch(`${it_.origin}/shares/${shared.token}/revoke`, { method: "POST", headers: libraryAuth })

    const first = await revoke()
    expect(first.status).toBe(200)
    expect(first.headers.get("cache-control")).toBe("no-store")
    expect(await first.json()).toEqual({ revoked: true })
    // Idempotent, and honest about it: the second call ended nothing.
    expect(await (await revoke()).json()).toEqual({ revoked: false })

    // The URL Bring kept now answers exactly what an unknown token answers.
    const afterRevoke = await shapeOf(await fetch(shared.url))
    const neverIssued = await shapeOf(await fetch(`${it_.origin}/r/${"B".repeat(43)}`))
    expect(afterRevoke).toEqual(neverIssued)
    expect(afterRevoke.status).toBe(NOT_FOUND_STATUS)
  })
})

describe("shop/the-handoff-is-the-operators-alone", () => {
  // Minting creates a permanent bearer credential and revoking ends one, so both
  // are behind the LIBRARY credential — never the phone's (PDR-0003), and never
  // nobody's. Every refusal is the shared not-found, byte for byte, so these two
  // addresses answer a caller who holds nothing exactly as a page does (ADR-0024).

  const refusals: readonly (readonly [string, Record<string, string>])[] = [
    ["no credential", {}],
    ["the ingest credential", { authorization: `Bearer ${INGEST_CREDENTIAL}` }],
    ["a wrong credential", { authorization: `Bearer ${"x".repeat(40)}` }],
  ]

  it.each(refusals)("refuses to mint for %s, and mints nothing", async (_, headers) => {
    const counted = countingStore()
    running = await startTestInstance({ capabilityStore: counted.store })
    const it_ = running
    const recipeId = await captured(it_, "Barley Bread")

    const res = await fetch(`${it_.origin}/recipes/${recipeId}/share`, {
      method: "POST",
      headers,
    })
    expect(res.status).toBe(NOT_FOUND_STATUS)
    expect(await res.text()).toBe(NOT_FOUND_BODY)
    // Refused BEFORE the store is touched. A route that minted and then withheld
    // the answer would pass every assertion above and fill the store for anyone.
    expect(counted.issued.count).toBe(0)
  })

  it("answers a recipe it does not hold exactly as a refused caller, and mints nothing", async () => {
    // Minting first and checking after would hand a caller a token for an id,
    // which is a yes/no on whether that id exists.
    const counted = countingStore()
    running = await startTestInstance({ capabilityStore: counted.store })
    const it_ = running

    const unknown = await shapeOf(
      await fetch(`${it_.origin}/recipes/no-such-recipe/share`, {
        method: "POST",
        headers: libraryAuth,
      }),
    )
    const refused = await shapeOf(
      await fetch(`${it_.origin}/recipes/no-such-recipe/share`, { method: "POST" }),
    )
    expect(unknown).toEqual(refused)
    expect(unknown.status).toBe(NOT_FOUND_STATUS)
    expect(counted.issued.count).toBe(0)
  })

  it.each(refusals)("refuses to revoke for %s, and the URL keeps working", async (_, headers) => {
    running = await startTestInstance({ servesItsOwnAddress: true })
    const it_ = running
    const recipeId = await captured(it_, "Oat Loaf")
    const shared = (await (await share(it_, recipeId)).json()) as Shared

    const res = await fetch(`${it_.origin}/shares/${shared.token}/revoke`, {
      method: "POST",
      headers,
    })
    expect(res.status).toBe(NOT_FOUND_STATUS)
    expect(await res.text()).toBe(NOT_FOUND_BODY)
    // The property that matters: the grant survived. A route that revoked and
    // then refused would be a kill switch anyone can pull.
    expect((await fetch(shared.url)).status).toBe(200)
  })

  it("does not mint on a GET", async () => {
    // A GET that minted would issue a live token on every prefetch, crawl or
    // reload, and nobody could say how many exist.
    const counted = countingStore()
    running = await startTestInstance({ capabilityStore: counted.store })
    const it_ = running
    const recipeId = await captured(it_, "Spelt Rolls")

    const res = await fetch(`${it_.origin}/recipes/${recipeId}/share`, { headers: libraryAuth })
    expect(res.status).toBe(NOT_FOUND_STATUS)
    expect(counted.issued.count).toBe(0)
  })
})
