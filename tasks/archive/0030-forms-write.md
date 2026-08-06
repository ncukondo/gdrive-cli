# Task 0030: `gdrive forms write` / `forms create`

Status: todo (move to `tasks/archive/` when done)
Depends on: 0029 — the document schema, `lib/form-document.ts` and
`lib/forms-api.ts` all come from it.
Parallel: no — it extends the same two lib files 0029 creates.

## Goal

An edited form document goes back into Drive: `forms write` applies it by item
id, reports what it did as a plan, refuses to delete without `--prune`, and
`forms create` makes a new form from one.

## Context

- Decisions: [`0028`](../decisions/0028-forms-write.md) is the specification;
  [`0027`](../decisions/0027-forms-document.md) defines the document it
  consumes. §1's match table and §3's `--prune` rule are the two things to get
  exactly right, and §3's three guarantees — nothing applied, the message names
  the flag, the code is `PRUNE_REQUIRED` — are what make a refusal usable by an
  agent rather than merely safe.
- Prior art in this repo: `commands/docs/create.ts` — create, then fill, then
  `moveFile` for `--parent`, with the API's inability to create in a folder
  noted in a comment. `forms create` is the same three steps
  ([`0028`](../decisions/0028-forms-write.md) §7).
- `lib/input.ts`'s `readInput` already handles a literal / `@file` / stdin
  argument; `--file` should not grow a fourth convention.
- Also relevant: [`0015`](../decisions/0015-no-type-assertions.md) (params
  checked against `forms_v1`), [`0007`](../decisions/0007-output-and-errors.md).
- **What 0029's review found, that lands on this task.** The document does not
  carry `settings.quizSettings.isQuiz`. 0027 defers *response* grading data
  (`totalScore`, per-answer `grade`), which is a different field, so this one was
  simply not projected. Two consequences are yours, and both destroy data
  silently if missed: `forms create` from a document that came out of a quiz
  produces a form that is not a quiz, and any `updateSettings` derived from the
  document sends `isQuiz: false`, which per Google's own field documentation
  "deletes all question Grading". The same applies to `question.grading`, which
  0027 defers legitimately. Decide before writing code whether this task carries
  the setting, refuses to touch settings it cannot represent, or scopes its
  `updateMask` so an absent field is never sent — and if the answer changes what
  the document holds, that is a new decision, not an edit to 0027
  ([`0032`](../decisions/0032-decisions-are-append-only.md)).
- An item that reads as `type: unsupported` must emit no request at all. 0029
  routes an image-bearing question, an unknown `choiceQuestion.type` and a scale
  missing a bound through that channel precisely because they cannot round-trip,
  and it relies on [`0028`](../decisions/0028-forms-write.md) §2 to make the
  reliance safe. Verify §2 actually says so before building on it.

## Scope

- `src/lib/form-document.ts` — the document → API direction, beside 0029's
  projection.
- `src/lib/forms-api.ts` — `batchUpdate`, `createForm`.
- `src/commands/forms/{write,create}.ts` + tests — new.
- `src/commands/forms/index.ts` — register both.
- `src/types/index.ts` — `ERROR_CODES` gains `PRUNE_REQUIRED` (exit 3).

## Out of scope

- Publish settings, response-destination linking, partial writes, and any
  three-way merge — all deferred in 0028.

## TDD plan

1. **The reverse projection** (`lib/form-document.ts`)
   - **Red** — each modelled `type` produces the API `Item` 0029's projection
     came from; feeding 0029's output back yields the original resource for
     every type. `type: unsupported` produces nothing.
   - **Green** — implement as a `switch` on the same discriminant 0029 built.
   - **Refactor** — a round-trip property test over the fixture set, so the two
     directions cannot drift.

2. **The request plan** — pure, no API; this is 0028 §1's table.
   - **Red** — given a form's current items and a document:
     - matching `id` → `updateItem`; missing `id` → `createItem` at its index;
     - a form item absent from the document → `deleteItem` **only** when
       pruning; without `--prune` planning fails with `PRUNE_REQUIRED`, naming
       both the items and the flag, and returns no partial plan a caller could
       apply (0028 §3);
     - reordering → `moveItem`;
     - an `id` in the document that the form does not have → error, not a
       create (0028 §1);
     - `type: unsupported` items produce no request but still occupy a position,
       so a `moveItem` around them uses the right indices;
     - a document identical to the form produces an empty plan.
   - **Green** — implement the planner as a function from
     `(currentItems, document, {prune})` to a request list.
   - **Refactor** — keep it pure and separately tested; it is the piece most
     likely to be read again.

3. **`forms write`**
   - **Red** — sends the planned batch with `writeControl.requiredRevisionId`
     when the document carries `revision_id`, and without it when it does not;
     a stale revision surfaces the API's conflict as a clear error (0028 §5);
     read-only fields in the document (`question_id`, `responder_uri`,
     `linked_sheet_id`, form `id`) are ignored rather than rejected (0028 §6);
     `--file`, `@file` and stdin all reach the same parser; malformed YAML and
     a schema violation both fail `INVALID_ARGS` naming the offending path;
     an empty plan makes no API write and says so.
   - **Red (the plan, 0028 §4)** — every `write` reports its plan: `data.plan`
     in JSON lists each create / update / move / delete with the item it names,
     and text mode summarizes it. `--dry-run` produces the same plan and issues
     no `batchUpdate` — assert the call count. A `PRUNE_REQUIRED` failure and a
     `--prune` success over the same document report the *same* deletions, one
     as refused and one as applied, so a caller can tell the three cases apart
     (applied / refused / never requested) without reading the exit code.
   - **Green** — implement.

4. **`forms create`**
   - **Red** — with a title only, creates an empty form; with `--file`, creates
     then applies the document in one `batchUpdate`; with `--parent`, moves the
     form afterwards and reports `parent_id`; quiet prints the new form id.
   - **Green** — implement, following `docs/create.ts`'s shape.

5. **Docs**
   - `docs/commands.md`: `write` and `create` in the `forms` section, with
     `--prune` documented as what it is — the only way to delete a question, and
     the reason deletion is not implicit — plus `--dry-run`, the plan's shape,
     and `PRUNE_REQUIRED` in the error-code reference.
   - `README.md` highlights: Forms goes from read to read/write.

## Acceptance criteria

- [ ] `gdrive forms read F > f.yaml && gdrive forms write F --file f.yaml`
      makes no change and reports an empty plan
- [ ] Editing a question's title in the document updates it in place, and the
      question's `question_id` is unchanged afterwards (verifiable with a
      second `forms read`)
- [ ] Adding an item without an `id` creates it at that position
- [ ] Removing an item fails with `PRUNE_REQUIRED` (exit 3) without `--prune`,
      naming both the item and the flag, and the form is unchanged afterwards;
      `--prune` deletes it
- [ ] `--dry-run` on the same document reports the same plan and changes nothing
- [ ] Every `write` reports `data.plan` in JSON, so a caller can tell an applied
      deletion from a refused one without reading the exit code
- [ ] A form edited in the browser between `read` and `write` makes the write
      fail rather than overwrite
- [ ] `gdrive forms create "New survey" --file f.yaml --parent Surveys` creates
      the form in that folder
- [ ] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check` pass
- [ ] `docs/commands.md` and `README.md` updated

## Verification

- `bun run test src/lib/form-document.test.ts` — both directions and the
  round-trip property
- `bun run test src/commands/forms` — the planner and both commands
- Manual, against a real account: read a form with two responses, rename a
  question, write it back, and confirm with `forms responses` that the existing
  answers are still attached to the renamed question. That is the whole reason
  0028 §1 matches on id, and only a real form can show it.
