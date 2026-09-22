/**
 * When a Cooking Plan is generated (`PDR-0004`, `ADR-0008`).
 *
 * `PDR-0004` decides this as a **configured policy shipping with `lazy` as its
 * default**, with `background` as the other supported value. Generating inside
 * the import request is not a third value that happens to be unconfigured: the
 * never-block rule forbids it, so it is absent from the type and there is
 * nothing to accidentally select.
 *
 * `ADR-0008` decides what executes `background`: in-process fire-and-forget
 * after the response is sent, with no queue, broker or worker process. A
 * generation lost to a restart is not an error path — the plan is derived data,
 * so the behaviour degrades to `lazy`, which is the shipped default and a
 * supported state.
 *
 * This module is the seam and nothing else. It holds no store, starts no timer
 * and imports nothing from the pipeline, so the import path cannot reach plan
 * generation through it — which is how `slice6/lazy-default-generates-nothing-
 * at-import` and `slice6/no-job-mechanism-introduced` are properties of the
 * shape rather than of one run.
 */

/** The supported values. Blocking generation inside the import request is not one. */
export const PLAN_GENERATION_POLICIES = ["lazy", "background"] as const
export type PlanGenerationPolicy = (typeof PLAN_GENERATION_POLICIES)[number]

/** `PDR-0004`'s shipped default, chosen on the operator's cost, not on latency. */
export const DEFAULT_PLAN_GENERATION_POLICY: PlanGenerationPolicy = "lazy"

/** The documented configuration key an operator sets. */
export const PLAN_GENERATION_POLICY_ENV = "COOKFRAME_PLAN_GENERATION"

/**
 * Read the configured policy. An unset value is the default; an unrecognised
 * one is also the default, and is reported rather than swallowed — an operator
 * who mistypes `backgroud` should not silently get behaviour they did not ask
 * for, and should not get a crashed instance either.
 */
export function readPlanGenerationPolicy(
  env: Readonly<Record<string, string | undefined>> = process.env,
  onUnrecognised: (value: string) => void = () => {},
): PlanGenerationPolicy {
  const raw = env[PLAN_GENERATION_POLICY_ENV]
  if (raw === undefined || raw === "") return DEFAULT_PLAN_GENERATION_POLICY
  const found = PLAN_GENERATION_POLICIES.find((policy) => policy === raw)
  if (found !== undefined) return found
  onUnrecognised(raw)
  return DEFAULT_PLAN_GENERATION_POLICY
}

/**
 * Whether importing a recipe under this policy generates a plan as part of the
 * import request. Never, for either value: `lazy` derives on first cooking
 * view, and `background` derives after the response has been sent. This is a
 * total function over the policy type, so adding a value that blocked would not
 * compile without someone changing this answer deliberately.
 */
export function importGeneratesPlan(_policy: PlanGenerationPolicy): false {
  return false
}

/**
 * Whether a cooking view must derive the plan now, given the policy and whether
 * a stored plan was found.
 *
 * Under `background` a generation can be lost — to a restart, or to a failure
 * after the response was sent — and `ADR-0008` says that is not an error path.
 * The cooking view therefore asks the same question under both policies: is
 * there a plan? If not, derive one. `background` is an optimisation on top of
 * `lazy`, never a replacement for it, which is what makes an incomplete
 * background generation degrade rather than fail.
 */
export function cookingViewMustDerive(
  _policy: PlanGenerationPolicy,
  storedPlanExists: boolean,
): boolean {
  return !storedPlanExists
}
