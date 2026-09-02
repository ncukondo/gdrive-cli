import type { ErrorData } from "../types/index.ts";
import { formatValues } from "./output.ts";

/**
 * What a `PRUNE_REQUIRED` refusal reports beside its message (issue #31).
 *
 * [`0028`](../../decisions/0028-forms-write.md) §4 puts the three answers a
 * caller has to tell apart — the deletion was applied, refused, or never asked
 * for — "in one place, in `data.plan`". A refusal could not hold one: an error
 * envelope had no `data` until
 * [`0031`](../../decisions/0031-recursive-copy.md) §3–§4 gave it an optional
 * one, so the list lived only inside a sentence and a caller who wanted it
 * parsed prose or spent a second round trip on `--dry-run --prune`.
 *
 * **The payload is the success envelope's `data` minus what the run never got
 * to**, which is `after-create.ts`'s rule and the reason a consumer can read
 * `data.plan` off either answer. Here that means the deletions and nothing
 * else: both planners throw before the moves, creates and updates are
 * computed, so anything more would mean planning past the refusal. `docs/` says
 * so, because a caller who reads this as the whole plan is wrong.
 *
 * There is deliberately **no `text`**. The message already names the items,
 * which is 0028 §3's guarantee, and a table under it is the same list twice.
 *
 * `quiet` is the ids, and it is worth saying why it is not the number these
 * commands print on success. `-q` asks for the bare value
 * ([`0038`](../../decisions/0038-quiet-asks-for-a-value.md)), and the value
 * differs because the question does: a success has changed `n` things and `n`
 * is the answer, while a refusal has changed nothing, so a count of what did
 * not happen is not a value — *which* items would have gone is. A caller
 * reading `-q` across both has an exit code telling them which question was
 * answered, as it does for every command here.
 *
 * It lives here rather than in either planner because both have the shape and
 * neither owns it — the same reason `after-create.ts` is here.
 */
export function refusedPlan(
  id: string | null | undefined,
  deletions: readonly { id?: string }[],
): ErrorData {
  return {
    payload: { ...(id ? { id } : {}), plan: deletions, applied: false },
    quiet: formatValues(deletions.flatMap((entry) => (entry.id === undefined ? [] : [entry.id]))),
  };
}
