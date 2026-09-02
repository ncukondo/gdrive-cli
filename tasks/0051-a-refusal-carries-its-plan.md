# Task 0051: A `PRUNE_REQUIRED` refusal carries the plan it refused

Status: todo
Depends on: —
Parallel: yes (worktree-safe) — beside 0049, 0050 and 0052; it owns
`src/commands/forms/` and `src/commands/slides/`, which none of them touch.

## Goal

`forms write` and `slides write`, refusing a deletion because `--prune` was not
given, put the items they would have deleted in the error envelope's `data`, so
a JSON caller reads the list instead of parsing it out of a sentence
(issue #31).

## Context

- Relevant decisions: [`0028`](../decisions/0028-forms-write.md) §3–§4 (the
  refusal, and that a caller tells applied / refused / never-asked apart from
  `data.plan`), [`0030`](../decisions/0030-slides-write.md) §4 (the same
  refusal for a deck), [`0031`](../decisions/0031-recursive-copy.md) §3–§4 (the
  optional `data` on the error envelope — general, not a `cp -r`
  accommodation), [`0057`](../decisions/0057-a-create-moves-before-it-fills.md)
  §2 (the second command family to use it, and the pattern in
  `src/lib/after-create.ts`).
- The envelope this issue was waiting for **has landed**: `ErrorData` and
  `AppErrorOptions.data` are in `src/types/index.ts` and `handleError` renders
  the payload. Task 0033 is archived. There is nothing left to wait for.
- The throw sites are `src/commands/forms/plan.ts:287` and
  `src/commands/slides/plan.ts:413`. Both build the item list for the message
  already; neither attaches it as data.
- `src/lib/after-create.ts` states the rule this follows: *the payload is the
  success envelope's `data` for the same command, minus what the run never got
  to*. A refusal is thrown before the moves, creates and updates are computed,
  so `plan` holds the deletions and nothing else — and `docs/` has to say so,
  because a caller who reads it as the whole plan is wrong.
- Both plan functions receive the raw form / presentation, which carries its own
  id (`FormRaw.formId`, `PresentationRaw.presentationId`). The payload needs no
  new parameter.
- **The payload alone does not reach a shell**, found while implementing.
  `handleError`'s `quiet` parameter defaulted to `false` and 39 of its 44 call
  sites omitted it — `forms write` and `slides write` among them — so a
  payload's `-q` values were dropped after being built correctly. Every unit
  test beside the handler still passed. The parameter becomes **required**,
  which is the same failure `tests/integration/failed-create.test.ts` was
  written for after task 0046's live pass, closed as a class rather than at the
  two sites this task needed. That widens the scope to every registrar, and the
  widening is mechanical and decided by `tsc`.

## Scope

- `src/commands/forms/plan.ts`, `src/commands/forms/plan.test.ts`
- `src/commands/slides/plan.ts`, `src/commands/slides/plan.test.ts`
- `src/lib/prune-refusal.ts` and its test — the payload both planners build,
  placed beside `after-create.ts` for the reason that file gives: both command
  families have the shape and neither owns it
- `tests/integration/refused-prune.test.ts` — the last three inches, in
  `failed-create.test.ts`'s style
- `src/index.ts` and every registrar, for the required `quiet` above
- `docs/commands.md` — the two `PRUNE_REQUIRED` paragraphs

## Out of scope

- Making the refusal report the *whole* plan — what `--prune` would create,
  update and move as well. That means computing past the refusal point and is a
  behaviour question, not a plumbing one; `--dry-run --prune` already answers
  it in one call. **This work will not be done**, and `docs/` names that call
  instead.
- Giving any other error code a payload. `PRUNE_REQUIRED` is the one issue #31
  names; a survey of the rest is not this task.

## TDD plan

1. **Red** — `src/commands/forms/plan.test.ts`: a document that drops one item,
   planned without `prune`, throws `PRUNE_REQUIRED` **and** the error's
   `data.payload` holds `{ id, plan, applied: false }`, where `plan` is one
   entry with `action: "delete"`, the item's id, its title and its index — the
   same `PlanEntry` shape a success reports. Assert the ids in `payload`, not
   the prose: the test has to fail if the message keeps naming them and the data
   does not.
2. **Red** — the same for a form item the form gave **no** id, which no document
   could have named: it appears in the plan with a title and an index and no
   `id`, exactly as it does after `--prune` applies it.
3. **Red** — `src/commands/slides/plan.test.ts`: the deck equivalent. A slide
   with no id is *not* among the deletions there (`deleteObject` addresses by
   id), so the payload matches that.
4. **Red** — `src/commands/forms/write.test.ts` and the slides one: `--quiet`
   on a refusal prints one id per line and nothing else, and `-f json` on a
   refusal is one envelope whose `success` is `false` and whose `data.plan` has
   the entries.
5. **Green** — attach `ErrorData` at the two throw sites. `payload` as above;
   `quiet` the ids via `formatValues`. **No `text`**: the message already names
   the items in prose, which is 0028 §3's guarantee, and a table repeating them
   under it is a second copy of the same list.
6. **Refactor** — the two sites build `what` and the count the same way. Only
   share it if the shared thing reads as one idea; two twelve-line blocks that
   happen to rhyme are not one.

## Acceptance criteria

- [ ] `gdrive forms write F --file d.yaml` refusing a deletion emits
      `{"success": false, "error": {"code": "PRUNE_REQUIRED", …}, "data": {"id": …, "plan": [...], "applied": false}}`
- [ ] The same for `gdrive slides write P`
- [ ] `-q` on a refusal prints the ids, one per line
- [ ] The message still names the items and the `--prune` flag (0028 §3 is not
      weakened by this)
- [ ] Exit code is still 3 (`PRUNE_REQUIRED` → `ExitCode.ARGUMENT`)
- [ ] `handleError` cannot be called without saying what `-q` should do
- [ ] `bun run test` and `bun run typecheck` pass
- [ ] `docs/commands.md` says what the refusal's `data.plan` holds — and that it
      is the deletions only, with `--dry-run --prune` named as the way to see
      the rest

## Verification

- Automated: `bun run test src/commands/forms src/commands/slides` — the payload
  shape, the no-id case, and the `-q` and `-f json` renderings.
  `bun run test:e2e` — nothing new. The refusal is decided entirely from the
  fetched form and the document, so the live suite would be asserting the fake's
  own arithmetic against Google for no gain.
- Manual, against a real account: none. Nothing here changes a request sent to
  Google — the refusal happens before the first `batchUpdate`, which is 0028
  §3's whole point.
