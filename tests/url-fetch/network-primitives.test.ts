/**
 * CFV1-S5 — the network-primitive net that the safe-fetch chokepoint scans with
 * (ADR-0010's single chokepoint). The chokepoint test only proves that today's
 * `src/` contains none of these; it cannot prove the net would CATCH a bypass
 * that is not there yet. This suite does: it pins both directions of the shared
 * pattern set so the guard cannot be defeated by a primitive it forgot to list,
 * nor watered down until it flags nothing.
 *
 * Each `describe`/`it` string is the acceptance-criterion proof id it satisfies.
 */
import { describe, expect, it } from "vitest"
import { NETWORK_PATTERNS } from "./network-primitives.js"

const flagged = (line: string): boolean => NETWORK_PATTERNS.some((p) => p.test(line))

describe("url-security/network-primitive-coverage", () => {
  it("flags every outbound network primitive a bypass could use", () => {
    const mustFlag = [
      'const r = await fetch("https://x")',
      "http.request(opts, cb)",
      "https.request(opts, cb)",
      "http.get(url, cb)",
      "https.get(url, cb)",
      'const s = http2.connect("https://x")',
      "http2.request(headers)",
      "net.connect(443, host)",
      "net.createConnection({ port: 443 })",
      "tls.connect(443, host)",
      'dgram.createSocket("udp4")',
      'const ws = new WebSocket("wss://x")',
      'const req = new Request("https://x")',
      'import net from "node:net"',
      'import tls from "node:tls"',
      'import dgram from "node:dgram"',
      'import http2 from "node:http2"',
      'import axios from "axios"',
      'import { request } from "undici"',
      'got("https://x")',
    ]
    for (const line of mustFlag) {
      expect(flagged(line), line).toBe(true)
    }
  })
})

describe("url-security/network-primitive-precision", () => {
  it("spares member access and identifiers that merely share a name", () => {
    const mustNotFlag = [
      "this.#snapshots.get(snapshotId)", // Map.get — the false positive to avoid
      "const existing = this.#versions.get(id) ?? []",
      "seen.get(digest)",
      "const field = payload.request", // a property named request, no call
      "widget.getItems()", // .get without an http(s). prefix
      "const later = scheduler.fetchLater", // fetch without a call
      "notabug.gotcha()", // got without its own call boundary
      'log("connected to net")', // the word net inside a string, not an import
    ]
    for (const line of mustNotFlag) {
      expect(flagged(line), line).toBe(false)
    }
  })
})
