/**
 * Runs the CFV1-S4 prototype's OWN script (spikes/s4-cooking-ux/prototype.html)
 * so the proofs below exercise the shipped rendering rules rather than a second
 * implementation of them. The prototype must stay a single plain HTML file with
 * no build step (proof: cooking-ux/plain-html-prototype), so it cannot export
 * anything: the harness extracts its inline script, gives it the few DOM calls
 * it makes, and evaluates it in a `node:vm` context whose bindings stay
 * reachable afterwards.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
export const spikeDir = join(repoRoot, "spikes", "s4-cooking-ux")
export const prototypePath = join(spikeDir, "prototype.html")
export const recipesPath = join(spikeDir, "recipes.json")

export const prototypeHtml = (): string => readFileSync(prototypePath, "utf8")
export const recipesJson = (): string => readFileSync(recipesPath, "utf8")

const DATA_BLOCK = /<script id="recipe-data" type="application\/json">\n([\s\S]*?)\n {4}<\/script>/
// Both blocks are caught by id. A pattern anchored on a bare `<script>` would
// widen silently if a second one were ever added above, and `vm.runInContext`
// would then evaluate the markup in between; by id it fails closed instead.
const BEHAVIOUR_BLOCK = /<script id="prototype-behaviour">\n([\s\S]*?)\n {4}<\/script>/

function capture(re: RegExp, what: string): string {
  const m = re.exec(prototypeHtml())
  if (!m?.[1]) throw new Error(`prototype.html: could not find its ${what}`)
  return m[1]
}

export const embeddedRecipeJson = (): string => capture(DATA_BLOCK, "#recipe-data block")
export const behaviourScript = (): string => capture(BEHAVIOUR_BLOCK, "#prototype-behaviour block")

/** The handful of element behaviours the prototype's script actually uses. */
class FakeNode {
  readonly children: FakeNode[] = []
  readonly attributes = new Map<string, string>()
  className: string | null = null
  value = ""
  private own = ""

  constructor(readonly tagName: string) {}

  get textContent(): string {
    if (this.children.length === 0) return this.own
    return this.own + this.children.map((c) => c.textContent).join("")
  }
  set textContent(v: string) {
    this.children.length = 0
    this.own = String(v)
  }
  appendChild(child: FakeNode): FakeNode {
    this.children.push(child)
    return child
  }
  setAttribute(name: string, v: string): void {
    this.attributes.set(name, String(v))
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }
  addEventListener(): void {
    /* the proofs drive `state` directly; no event dispatch is needed */
  }
}

export interface Rendered {
  /** Every element carrying a class, depth-first, as `{ cls, text }`. */
  readonly nodes: readonly { readonly cls: string; readonly text: string }[]
  /** One entry per rendered cooking unit, in order — so an assertion about a
   *  unit reads that unit and cannot be satisfied by text elsewhere on the page. */
  readonly units: readonly UnitView[]
  readonly text: string
}

export interface UnitView {
  readonly head: string
  /** The NOW YOU NEED row, or undefined where the block was not rendered. */
  readonly block: string | undefined
  readonly action: string
  readonly reserve: string | undefined
  readonly critical: string | undefined
}

function flatten(node: FakeNode, into: { cls: string; text: string }[]): void {
  if (node.className) into.push({ cls: node.className, text: node.textContent })
  for (const c of node.children) flatten(c, into)
}

const has = (node: FakeNode, cls: string) => (node.className ?? "").split(/\s+/).includes(cls)

function collect(node: FakeNode, cls: string, into: FakeNode[]): FakeNode[] {
  if (has(node, cls)) into.push(node)
  for (const c of node.children) collect(c, cls, into)
  return into
}

function unitView(box: FakeNode): UnitView {
  const own = (cls: string): string | undefined => collect(box, cls, [])[0]?.textContent
  return {
    head: own("unit-head") ?? "",
    block: own("items"),
    action: own("action") ?? "",
    reserve: own("reserve"),
    critical: own("critical"),
  }
}

export interface Prototype {
  /** Evaluate an expression against the prototype's own bindings. */
  readonly evaluate: <T>(expression: string) => T
  /** Re-render with the given control state and return what the page shows. */
  readonly render: (state: { recipe: number; hyp?: "A" | "B"; suppress?: boolean }) => Rendered
  /** The `DATA` object the prototype parsed — mutating it plants a violation. */
  readonly data: {
    recipes: {
      title: string
      units: { n: number; critical: string | null; nowYouNeed: { qty: string; item: string }[] }[]
      beforeYouStart: {
        startNow: StartNowEntry[]
        startNowRejected: StartNowEntry[]
        fetchPrepare: { item: string; assumedAtHand: boolean }[]
      }
    }[]
  }
}

export interface StartNowEntry {
  do: string
  slow: boolean
  safeToLeave: boolean
  neededAtUnit: number
  why?: string
}

/** A fresh prototype run; each call is isolated, so a planted mutation is contained. */
export function loadPrototype(): Prototype {
  const elements = new Map<string, FakeNode>()
  const document = {
    getElementById(id: string): FakeNode {
      let n = elements.get(id)
      if (!n) {
        n = new FakeNode(id === "recipe-data" ? "script" : "div")
        if (id === "recipe-data") n.textContent = embeddedRecipeJson()
        elements.set(id, n)
      }
      return n
    },
    createElement: (tag: string) => new FakeNode(tag),
    createTextNode: (t: string) => {
      const n = new FakeNode("#text")
      n.textContent = t
      return n
    },
  }
  const context = vm.createContext({ document, console })
  vm.runInContext(behaviourScript(), context, { filename: "prototype.html" })

  const evaluate = <T>(expression: string): T => vm.runInContext(expression, context) as T

  return {
    evaluate,
    data: evaluate("DATA"),
    render(next) {
      evaluate(`state.recipe = ${next.recipe}`)
      evaluate(`state.hyp = ${JSON.stringify(next.hyp ?? "A")}`)
      evaluate(`state.suppress = ${next.suppress === true}`)
      evaluate("render()")
      const app = elements.get("app")
      if (!app) throw new Error("prototype.html: render() produced no #app")
      const nodes: { cls: string; text: string }[] = []
      flatten(app, nodes)
      const units = collect(app, "unit", []).map(unitView)
      return { nodes, units, text: app.textContent }
    },
  }
}

/** Text of every element carrying this class token, in document order. */
export const allOf = (rendered: Rendered, cls: string): string[] =>
  rendered.nodes.filter((n) => n.cls.split(/\s+/).includes(cls)).map((n) => n.text)

/** The text of the one element carrying this class token, or undefined. */
export function only(rendered: Rendered, cls: string): string | undefined {
  const hits = allOf(rendered, cls)
  return hits.length === 1 ? hits[0] : undefined
}
