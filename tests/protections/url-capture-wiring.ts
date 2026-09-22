/**
 * What the composition root hands the URL route, read from the tree.
 *
 * The defect this exists for was found in review, on the change that created it.
 * `serve/every-ingest-entry-point-is-reachable` had just closed "the import has
 * no caller" — and the caller it got passed `deps.capture`, the photo path's
 * model provider. `src/pipeline/url-capture.ts` composes the deterministic
 * JSON-LD reader with a model fallback and hands that fallback the EXTRACTED
 * TEXT rather than the markup (ADR-0019 §4a); `createUrlCaptureProvider` had no
 * caller in `src/` at all. So the import was reachable and the capability behind
 * it was not: every fetched page went to a model, whole, as HTML.
 *
 * The same shape one layer down, which is why the answer is the same kind of
 * rule rather than another behavioural case. A proof can hand an instance the
 * composite and show what it does — `run/a-link-can-be-imported-from-a-running-instance`
 * does — and that proof is true of whatever pair the TEST composed. Only the
 * composition root says which pair a running instance composes, so only reading
 * it answers the question.
 *
 * **What this sees.** Two facts, in two files:
 *
 *  1. the URL route hands `importFromUrl` the field `deps.urlCapture`, not
 *     `deps.capture` — a separate seam, not a shared one;
 *  2. the composition root builds that field with `createUrlCaptureProvider`,
 *     around `createDeterministicUrlCaptureProvider`.
 *
 * **What it does not see.** Whether the fallback it composes is the real
 * model-backed provider (it reads a name, not a value), and whether the
 * composite behaves as documented — the deterministic half first, the model half
 * only on `InsufficientRecipeJsonLdError`. `tests/slice4/url-fallback.test.ts`
 * owns that behaviour and the run proof owns the instance's end of it. This file
 * owns the one link between them: that the thing on the path is that thing.
 *
 * Both functions are pure over TEXT, like the detectors in
 * `ingest-entry-points.ts` and `configured-database.ts`, so the tables in the
 * proof can plant violations rather than depend on what the tree holds today.
 */
import ts from "typescript"

/** A field of an object literal, and what it was given. */
export interface FieldValue {
  /** The property name, as written. */
  readonly field: string
  /**
   * The initializer's source text, normalized to one line.
   *
   * Text rather than a resolved value on purpose: the claim this supports is
   * about which SEAM the route reads, and `deps.capture` versus
   * `deps.urlCapture` is exactly that claim, spelled.
   */
  readonly value: string
  /** The callee's name when the initializer is a call, else `undefined`. */
  readonly callee?: string
  /** The callee's name of the initializer's FIRST argument, when that is a call. */
  readonly firstArgumentCallee?: string
  /** `where:line`, so a finding names a place rather than a fact. */
  readonly at: string
}

const calleeName = (node: ts.Node): string | undefined => {
  if (!ts.isCallExpression(node)) return undefined
  const { expression } = node
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim()

function fieldsOfObject(
  object: ts.ObjectLiteralExpression,
  file: ts.SourceFile,
  where: string,
): FieldValue[] {
  const out: FieldValue[] = []
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const name = property.name
    if (!ts.isIdentifier(name) && !ts.isStringLiteral(name)) continue
    const initializer = property.initializer
    const callee = calleeName(initializer)
    const firstArgument = ts.isCallExpression(initializer) ? initializer.arguments[0] : undefined
    out.push({
      field: ts.isIdentifier(name) ? name.text : name.text,
      value: oneLine(initializer.getText(file)),
      ...(callee === undefined ? {} : { callee }),
      ...(firstArgument === undefined || calleeName(firstArgument) === undefined
        ? {}
        : { firstArgumentCallee: calleeName(firstArgument) as string }),
      at: `${where}:${file.getLineAndCharacterOfPosition(property.getStart(file)).line + 1}`,
    })
  }
  return out
}

/**
 * The fields of the object literal passed as the first argument of every call to
 * `callee` in `source`.
 *
 * Scoped to one call's own argument rather than to the file, because the two
 * entry points compose the same field name: `ingest(...)` for a photograph takes
 * the photo provider, and reading `capture:` file-wide would make the two
 * indistinguishable — which is the confusion this rule exists to prevent.
 */
export function collaboratorsPassedTo(
  source: string,
  callee: string,
  where = "in-memory.ts",
): FieldValue[] {
  const file = ts.createSourceFile(where, source, ts.ScriptTarget.Latest, true)
  const out: FieldValue[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeName(node) === callee) {
      const first = node.arguments[0]
      if (first !== undefined && ts.isObjectLiteralExpression(first)) {
        out.push(...fieldsOfObject(first, file, where))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out
}

/**
 * Every named field of every object literal in `source`, wherever it appears.
 *
 * The composition root is one nested object literal, so a rule about it cannot
 * name the call it sits in without pinning the entry point's own shape as well.
 * Breadth is bought back in the proof, which asserts what the named fields hold
 * rather than merely that they exist.
 */
export function fieldsAssignedIn(source: string, where = "in-memory.ts"): FieldValue[] {
  const file = ts.createSourceFile(where, source, ts.ScriptTarget.Latest, true)
  const out: FieldValue[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) out.push(...fieldsOfObject(node, file, where))
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out
}
