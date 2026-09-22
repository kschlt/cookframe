/**
 * What `background` actually does (CFV1-SL6, `PDR-0004`, `ADR-0008`).
 *
 * `PDR-0004` decides WHEN a plan is generated — a configured policy, `lazy` by
 * default, `background` as the other supported value, and blocking the import
 * request forbidden. `ADR-0008` decides WHAT EXECUTES `background`: in-process
 * fire-and-forget after the response is sent, with no queue, no broker and no
 * worker. This module is that, and nothing more.
 *
 * It lives in `src/http/` rather than in `src/pipeline/` or `src/cooking/`, and
 * both exclusions are load-bearing:
 *
 *  - **`src/pipeline/` must keep having no door to plan generation.** That is
 *    what makes "no generation inside an import request" a claim about every
 *    caller rather than about one run (`slice6/lazy-default-generates-nothing-
 *    at-import`). Putting the composition there would open exactly that door.
 *  - **`src/cooking/` must keep reaching no store.** The derivation is a pure
 *    function of a Canonical Recipe; joining it to a repository is composition,
 *    and composition is this layer's job.
 *
 * **`setTimeout` is the mechanism, and it is the one `ADR-0008` sanctioned.** A
 * macrotask cannot run until the turn that scheduled it has finished, which is
 * what puts generation strictly after the response. It is not a queue, a broker
 * or a worker: nothing is enqueued, nothing is brokered, and a generation lost
 * to a restart is not an error path — the plan is derived data, so the next
 * cooking view derives it again and the behaviour degrades to `lazy`, which is
 * the shipped default and a supported state.
 */

import { deriveCookingPlan, type PlanGenerationPolicy } from "../cooking/index.js"
import type { CanonicalVersion, RecipeRepository } from "../persistence/index.js"

/**
 * How work is deferred past the current turn. Injected so a proof can hold the
 * work rather than run it, and observe that the response arrives first.
 */
export type Scheduler = (work: () => Promise<void> | void) => void

/**
 * The shipped scheduler: a macrotask, so the work cannot begin until the handler
 * has returned and the response has been written.
 */
export const afterCurrentTurn: Scheduler = (work) => {
  setTimeout(() => {
    void Promise.resolve()
      .then(work)
      .catch(() => {
        // Already reported through `onFailed`; a rejection escaping here would
        // be an unhandled rejection on a path whose whole point is that losing
        // it costs nothing.
      })
  }, 0)
}

export interface PlanGenerationDeps {
  readonly repo: RecipeRepository
  /** The configured policy (`PDR-0004`). Under `lazy`, nothing is scheduled. */
  readonly policy: PlanGenerationPolicy
  readonly schedule?: Scheduler
  /**
   * Told when a background generation did not complete. Observation only: the
   * import has already succeeded and the recipe is already viewable, so nothing
   * about the response depends on this.
   */
  readonly onFailed?: (recipeId: string, reason: unknown) => void
}

/**
 * Build the hook the import route calls once its response is on its way.
 *
 * The returned function is `void`, deliberately: a caller cannot await it, so a
 * route cannot make the import wait on generation even by mistake. Under `lazy`
 * it schedules nothing at all — not "schedules a no-op", which would leave the
 * difference between the policies invisible from outside.
 */
export function createAfterImport(deps: PlanGenerationDeps): (version: CanonicalVersion) => void {
  if (deps.policy !== "background") return () => {}
  const schedule = deps.schedule ?? afterCurrentTurn
  return (version) => {
    schedule(async () => {
      try {
        await deps.repo.storeCookingPlan(
          deriveCookingPlan(version.recipe, { canonicalVersion: version.version }),
        )
      } catch (reason) {
        deps.onFailed?.(version.recipeId, reason)
      }
    })
  }
}
