/**
 * The release deploy workflow's three claims.
 *
 * `ci.yml` has no deploy and no secret (`slice0/no-deploy-from-fork-prs`), and
 * the one workflow that does deploy has to stay narrow in the same way. These
 * read the file; what Fly does with it is Fly's behaviour. Each `describe`
 * string is the proof id it satisfies.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { parse as parseYaml } from "yaml"

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const text = readFileSync(join(root, ".github", "workflows", "deploy.yml"), "utf8")
const wf = parseYaml(text) as {
  on: Record<string, unknown>
  permissions: Record<string, string>
  jobs: Record<string, { environment?: string; steps: { uses?: string; run?: string }[] }>
}

describe("run/the-deploy-workflow-triggers-only-on-a-release", () => {
  it("runs on a published release and on nothing a fork can cause", () => {
    expect(Object.keys(wf.on)).toEqual(["release"])
    expect(text).not.toMatch(/pull_request|workflow_dispatch|push:/)
  })
})

describe("run/the-deploy-workflow-is-gated-and-least-privilege", () => {
  it("reads the token only through the production environment and writes nothing", () => {
    expect(wf.permissions).toEqual({ contents: "read" })
    expect(wf.jobs["deploy"]?.environment).toBe("production")
    expect(text).toMatch(/secrets\.FLY_API_TOKEN/)
  })
})

describe("run/the-deploy-workflow-builds-remotely", () => {
  it("deploys with --remote-only and --ha=false, pinning every action", () => {
    const steps = wf.jobs["deploy"]?.steps ?? []
    expect(steps.some((s) => /flyctl deploy --remote-only --ha=false/.test(s.run ?? ""))).toBe(true)
    for (const s of steps) if (s.uses) expect(s.uses, s.uses).toMatch(/@[\w.]+$/)
    expect(text).not.toMatch(/@master|@main/)
  })
})
