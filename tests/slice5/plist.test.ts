/**
 * The property-list reader's own proofs.
 *
 * `slice5/shortcut-definition-committed-and-clean` reads the committed Shortcut
 * through this parser, so a parser that quietly accepted a malformed document
 * would make that criterion pass on a file Shortcuts cannot open. Its
 * STRICTNESS is therefore the part worth proving: each case below is a document
 * that must be REFUSED, not merely read.
 */
import { describe, expect, it } from "vitest"
import { allStrings, PlistParseError, parsePlist } from "./plist.js"

const wrap = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">${body}</plist>`

describe("slice5/plist-reader-reads-the-subset", () => {
  it("reads the shapes the Shortcut format is made of", () => {
    const value = parsePlist(
      wrap(`<dict>
        <key>name</key><string>Capture Recipe</string>
        <key>version</key><integer>1200</integer>
        <key>enabled</key><true/>
        <key>disabled</key><false/>
        <key>actions</key><array><string>one</string><string>two</string></array>
        <key>empty</key><array/>
        <key>nested</key><dict><key>inner</key><string>value</string></dict>
      </dict>`),
    )
    expect(value).toEqual({
      name: "Capture Recipe",
      version: 1200,
      enabled: true,
      disabled: false,
      actions: ["one", "two"],
      empty: [],
      nested: { inner: "value" },
    })
  })

  it("decodes entities, so an escaped character is compared as itself", () => {
    // A credential containing `&` would otherwise be invisible to the scan that
    // looks for one.
    expect(parsePlist(wrap("<string>a&amp;b &lt;c&gt; &#65;</string>"))).toBe("a&b <c> A")
  })

  it("drops comments, the declaration and the DOCTYPE without reading them as content", () => {
    const value = parsePlist(
      `<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "x">
       <!-- a comment holding <string>not content</string> -->
       <plist version="1.0"><string>content</string></plist>`,
    )
    expect(value).toBe("content")
  })

  it.each([
    ["an unclosed element", "<dict><key>a</key><string>b</string>"],
    ["a mismatched close", "<dict><key>a</key><string>b</array></dict>"],
    ["an element it does not understand", "<dict><key>a</key><data>AAAA</data></dict>"],
    ["a key with no value", "<dict><key>a</key></dict>"],
    ["a value with no key", "<dict><string>orphan</string></dict>"],
    ["an empty key", "<dict><key></key><string>b</string></dict>"],
    [
      "a duplicate key",
      "<dict><key>a</key><string>b</string><key>a</key><string>c</string></dict>",
    ],
    ["an integer that is not one", "<dict><key>a</key><integer>later</integer></dict>"],
    ["an unknown entity", "<string>&nbsp;</string>"],
  ])("refuses %s rather than reading past it", (_what, body) => {
    expect(() => parsePlist(wrap(body))).toThrow(PlistParseError)
  })

  it("refuses content after the root, which a lenient reader would ignore", () => {
    expect(() => parsePlist(`${wrap("<string>a</string>")}<string>b</string>`)).toThrow(
      PlistParseError,
    )
  })

  it("collects every string, keys included, so a scan cannot miss one", () => {
    // The clean-file scan reads this list. A collector that skipped keys, or
    // skipped inside arrays, would hide a secret pasted in either place.
    const value = parsePlist(
      wrap(`<dict>
        <key>outer</key>
        <array><dict><key>deep</key><string>secret-here</string></dict></array>
      </dict>`),
    )
    expect(allStrings(value)).toEqual(["outer", "deep", "secret-here"])
  })
})
