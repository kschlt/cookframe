/**
 * A reader for the XML property-list subset the committed Shortcut uses.
 *
 * Written here rather than taken as a dependency: the whole file it reads is
 * forty lines of vocabulary — `dict`, `array`, `string`, `integer`, `true`,
 * `false` — and a parser is a proof's instrument, so one whose behaviour is
 * visible beside the proof is worth more than one whose is not.
 *
 * It is deliberately STRICT. `Shortcuts accepts this file` is unverified here
 * (`OQ-38`), so the one thing this reader can honestly contribute is refusing
 * anything it does not fully understand: an unclosed tag, an unknown element, a
 * `dict` whose keys and values do not pair up. A lenient reader would turn a
 * malformed commit into a passing proof, which is the shape of failure this
 * project keeps finding. Its own behaviour is proved in `plist.test.ts`.
 */

export type PlistValue =
  | string
  | number
  | boolean
  | readonly PlistValue[]
  | { readonly [key: string]: PlistValue }

/** Raised when the document is not the property-list subset this understands. */
export class PlistParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PlistParseError"
  }
}

interface Token {
  readonly kind: "open" | "close" | "empty"
  readonly name: string
  readonly text: string
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
}

function decode(text: string): string {
  return text.replace(/&(#x?[0-9A-Fa-f]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
    }
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
    const named = ENTITIES[body]
    if (named === undefined) throw new PlistParseError(`unknown entity &${body};`)
    return named
  })
}

/** Comments, the XML declaration and the DOCTYPE carry no value and are removed. */
function stripProlog(xml: string): string {
  return xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[^>]*>/g, "")
}

function tokenize(xml: string): Token[] {
  const tokens: Token[] = []
  const pattern = /<(\/?)([A-Za-z][A-Za-z0-9]*)([^>]*?)(\/?)>/g
  let cursor = 0
  let match = pattern.exec(xml)
  while (match !== null) {
    const text = xml.slice(cursor, match.index)
    const [whole, closing, name, , selfClosing] = match
    tokens.push({
      kind: closing === "/" ? "close" : selfClosing === "/" ? "empty" : "open",
      name: name ?? "",
      text,
    })
    cursor = match.index + whole.length
    match = pattern.exec(xml)
  }
  if (xml.slice(cursor).trim() !== "") {
    throw new PlistParseError(`trailing text after the last element: ${xml.slice(cursor).trim()}`)
  }
  return tokens
}

/** Parse the document, or throw. Returns the value inside `<plist>`. */
export function parsePlist(xml: string): PlistValue {
  const tokens = tokenize(stripProlog(xml))
  let at = 0

  const expectOpen = (name: string): void => {
    const token = tokens[at]
    if (token === undefined || token.kind !== "open" || token.name !== name) {
      throw new PlistParseError(`expected <${name}>, found ${describe(token)}`)
    }
    at += 1
  }
  const expectClose = (name: string): void => {
    const token = tokens[at]
    if (token === undefined || token.kind !== "close" || token.name !== name) {
      throw new PlistParseError(`expected </${name}>, found ${describe(token)}`)
    }
    at += 1
  }

  function value(): PlistValue {
    const token = tokens[at]
    if (token === undefined) throw new PlistParseError("the document ends mid-value")
    if (token.kind === "empty") {
      at += 1
      if (token.name === "true") return true
      if (token.name === "false") return false
      if (token.name === "array") return []
      if (token.name === "dict") return {}
      throw new PlistParseError(`<${token.name}/> is not a value this reader understands`)
    }
    if (token.kind !== "open") {
      throw new PlistParseError(`expected a value, found ${describe(token)}`)
    }
    switch (token.name) {
      case "string": {
        at += 1
        const text = tokens[at]?.text ?? ""
        expectClose("string")
        return decode(text)
      }
      case "integer":
      case "real": {
        at += 1
        const raw = decode(tokens[at]?.text ?? "").trim()
        expectClose(token.name)
        const parsed = Number(raw)
        if (!Number.isFinite(parsed)) throw new PlistParseError(`<${token.name}> holds "${raw}"`)
        return parsed
      }
      case "true":
      case "false": {
        at += 1
        expectClose(token.name)
        return token.name === "true"
      }
      case "array": {
        at += 1
        const out: PlistValue[] = []
        while (tokens[at]?.kind !== "close") out.push(value())
        expectClose("array")
        return out
      }
      case "dict": {
        at += 1
        const out: Record<string, PlistValue> = {}
        while (tokens[at]?.kind !== "close" || tokens[at]?.name !== "dict") {
          expectOpen("key")
          const key = decode(tokens[at]?.text ?? "")
          expectClose("key")
          if (key === "") throw new PlistParseError("a <key> is empty")
          if (Object.hasOwn(out, key)) throw new PlistParseError(`duplicate key \`${key}\``)
          out[key] = value()
        }
        expectClose("dict")
        return out
      }
      default:
        throw new PlistParseError(`<${token.name}> is not a value this reader understands`)
    }
  }

  expectOpen("plist")
  const root = value()
  expectClose("plist")
  if (at !== tokens.length) throw new PlistParseError("content follows </plist>")
  return root
}

function describe(token: Token | undefined): string {
  if (token === undefined) return "the end of the document"
  return token.kind === "close" ? `</${token.name}>` : `<${token.name}>`
}

/** Every string anywhere in the value, in document order. */
export function allStrings(value: PlistValue): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(allStrings)
  if (typeof value === "object" && value !== null) {
    return Object.entries(value as Record<string, PlistValue>).flatMap(([key, inner]) => [
      key,
      ...allStrings(inner),
    ])
  }
  return []
}

/**
 * Every value a `<key>WFDictionaryKey</key>` names, anywhere in the document.
 *
 * These are the response fields the Shortcut reads out of the instance's answer,
 * so they are the client's half of a contract whose other half is the endpoint.
 * Collected by walking the parsed document rather than by regex over the text,
 * because a key inside a comment is not a key the client reads.
 */
export function dictionaryKeysRead(value: PlistValue): string[] {
  const found: string[] = []
  const walk = (node: PlistValue): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (node !== null && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (key === "WFDictionaryKey" && typeof child === "string") found.push(child)
        else walk(child as PlistValue)
      }
    }
  }
  walk(value)
  return [...new Set(found)].sort()
}
