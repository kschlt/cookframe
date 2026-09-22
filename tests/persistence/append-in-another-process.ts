/**
 * CFV1-PG — the other process in `persistence/a-restart-keeps-the-library`.
 *
 * This is not a helper the test could have inlined. The claim is that a recipe
 * imported by one process is readable by a second process that shares nothing
 * with the first but the database, and a claim about two processes cannot be
 * proved inside one: two store objects in the same test share a module graph, a
 * heap and a `Map`, so the in-memory store would pass a test written that way
 * and the criterion would be vacuous. So this file is spawned, it writes, it
 * exits, and only then does the test process read.
 *
 * It builds its recipe exactly as the contract suite does — the public snapshot
 * fixture through the deterministic fake normalization provider — so the reader
 * knows what to expect without anything being handed across.
 *
 * Usage: tsx tests/persistence/append-in-another-process.ts <databaseUrl> <runId>
 * Prints one JSON line: {"recipeId":…,"version":…}
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { SourceSnapshot } from "../../schema/index.js"
import { createPostgresStore } from "../../src/persistence/index.js"
import { createFakeNormalizationProvider } from "../../src/pipeline/fake-providers.js"

async function main(): Promise<void> {
  const [databaseUrl, runId] = process.argv.slice(2)
  if (databaseUrl === undefined || runId === undefined) {
    throw new Error("usage: append-in-another-process.ts <databaseUrl> <runId>")
  }
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
  const snapshot = SourceSnapshot.parse(
    JSON.parse(
      readFileSync(join(repoRoot, "evals/fixtures/public/source-snapshot/basic.json"), "utf8"),
    ),
  )
  const canonical = await createFakeNormalizationProvider().normalize(snapshot, {
    runId,
    targetOntologyVersion: "1.0.0",
  })

  const handle = createPostgresStore(databaseUrl)
  try {
    await handle.repository.storeSnapshot(snapshot)
    const appended = await handle.repository.appendCanonicalVersion(canonical)
    process.stdout.write(
      `${JSON.stringify({ recipeId: appended.recipeId, version: appended.version })}\n`,
    )
  } finally {
    await handle.close()
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exit(1)
})
