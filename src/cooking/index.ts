/**
 * The derived Cooking Plan (CFV1-SL6): derivation from the Canonical Recipe,
 * and the generation-policy seam `PDR-0004` decided.
 *
 * This barrel deliberately exports no store, no queue and no way to reach the
 * import pipeline, and no module under `src/cooking/` imports one. The slice's
 * two structural claims rest on that: plan generation cannot happen inside an
 * import request because the import path has no door to it, and no job
 * mechanism enters V1 because there is none here to enter through.
 */

export {
  DERIVER_VERSION,
  type DeriveOptions,
  deriveCookingPlan,
  stepsInCanonicalOrder,
  UntraceablePlanFactError,
  unitNeedsItsAmountBlock,
} from "./derive.js"
export {
  cookingViewMustDerive,
  DEFAULT_PLAN_GENERATION_POLICY,
  importGeneratesPlan,
  PLAN_GENERATION_POLICIES,
  PLAN_GENERATION_POLICY_ENV,
  type PlanGenerationPolicy,
  readPlanGenerationPolicy,
} from "./policy.js"
