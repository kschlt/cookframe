/**
 * How often does a real recipe page carry more than one distinct Recipe node?
 *
 * Run against the SHIPPED `extractRecipeJsonLd`, not a re-implementation — the
 * CFV1-INJ calibration was wrong for exactly that reason once already. Fetches
 * the S2 corpus's own URLs; no page content is written anywhere.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { extractRecipeJsonLd } from "/home/user/cookframe/src/pipeline/url-jsonld-adapter.js"

const results = JSON.parse(
  readFileSync("/home/user/cookframe/spikes/url-extraction/results.json", "utf8"),
).results as { site: string; url: string; fetched: boolean }[]

async function main() {
const rows: Record<string, unknown>[] = []
for (const entry of results.filter((r) => r.fetched)) {
  try {
    const res = await fetch(entry.url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; cookframe-spike/1.0)" },
      signal: AbortSignal.timeout(20000),
    })
    const html = await res.text()
    const extraction = extractRecipeJsonLd(html)
    rows.push({
      site: entry.site,
      status: res.status,
      kind: extraction.kind,
      count: extraction.kind === "multiple" ? extraction.inventory.count : 1,
      titles: extraction.kind === "multiple" ? extraction.inventory.titles : undefined,
    })
  } catch (e) {
    rows.push({ site: entry.site, status: "error", kind: "fetch-failed", detail: String(e).slice(0, 120) })
  }
  process.stderr.write(".")
}
writeFileSync("/tmp/claude-0/count-raw.json", JSON.stringify(rows, null, 2))
console.log("\n" + JSON.stringify(rows.map((r) => ({ site: r.site, kind: r.kind, count: r.count })), null, 1))
}
void main()
