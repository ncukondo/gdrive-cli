# Task 0048: The generated-type guard reaches inside a Drive `requestBody`

Status: todo
Depends on: —
Parallel: yes (worktree-safe) — beside 0047, 0049 and 0050; it owns
`src/lib/google-clients.ts` and nothing else does.

## Goal

A field this CLI puts inside a Drive `requestBody` fails `bun run typecheck`
when googleapis no longer has it, the way a Docs, Forms or Slides request field
already does (issue #29).

## Context

- Relevant decisions: [`0015`](../decisions/0015-no-type-assertions.md) (why
  these checks exist at all), [`0026`](../decisions/0026-ln.md) §6 — which
  claims the guard already covers this. It does not; issue #29 is the
  correction, and per
  [`0032`](../decisions/0032-decisions-are-append-only.md) §3 that record is not
  edited and gains no back-pointer.
- `GeneratedParamChecks` in `src/lib/google-clients.ts` compares only the
  *top-level* keys of each call's params. `requestBody` is one such key, so
  everything inside it — `name`, `mimeType`, `parents`,
  `shortcutDetails.targetId` — is invisible to it.
- The mechanism to copy is in the same file: `UnknownRequestKeys` plus a
  `X extends Schema ? true : never` companion, as `DocsRequestChecks` uses.
  `UnknownRequestKeys` is reused rather than replaced: nothing in it is
  union-specific, and its `T extends unknown` distributes over an interface as a
  no-op.
- **`UnknownRequestKeys` had to be fixed before it could do this job**, found
  while implementing. It read `keyof T[K]` on our side without `NonNullable`.
  For an *optional* field `T[K]` is `X | undefined` and `keyof` of that is
  `never`, so the inner keys were compared against nothing and every one passed
  — and `shortcutDetails?:` is optional, so the field issue #29 names is the one
  the check would still have missed. The generated side already had
  `NonNullable`, for the same reason one number over: the schema makes every
  field nullable. Both sides have it now. This widens the scope beyond what the
  plan first drew, and it is the same class rather than an addition to it.
- The three bodies are `FileCreateBody`, `PermissionBody`, and `files.update`'s,
  which was declared inline in the port and so could not be named by any check.

## Scope

- `src/lib/google-clients.ts`
- `src/lib/api.ts` — only if a body type turns out to disagree with
  `drive_v3.Schema$File` and the *body* is what is wrong.

## Out of scope

- A second level down. `insertText: { location: { index } }` — `location`'s own
  keys stay unchecked, in the new guard and in the three beside it. **This work
  will not be done**: every body here is one level deep, and a recursive check
  would be written against no case that needs it.
- Widening the guard to Sheets `requestBody`s or to the `media` half of an
  upload. Not surveyed, and adding an unexamined check is how a guard gets
  disabled later. Tracked by issue #29's own scope — if a gap is found while
  doing this, it goes in a comment on that issue rather than into this branch.

## TDD plan

There is no runtime behaviour here, so the red step is a type error rather than
a failing test — the same shape task 0016 used for the checks this extends.

1. **Red** — add a field to `FileCreateBody` that `drive_v3.Schema$File` does
   not have (`shortcutDetails_TYPO`), confirm `bun run typecheck` **passes**
   today. That is the defect, demonstrated.
2. **Green** — add `DriveBodyChecks` to `google-clients.ts` asserting that
   `FileCreateBody` and `PermissionBody` are assignable to
   `drive_v3.Schema$File` and `drive_v3.Schema$Permission`, and that every key
   of each is a key of the generated schema. Re-run: the typo now fails the
   check, naming the key.
3. **Refactor** — remove the typo. `bun run typecheck` is green. Check that the
   real `shortcutDetails?: { targetId: string }` passes, including its inner
   field, and that `parents?: string[]` still does — `Schema$File["parents"]` is
   `string[] | null`, so the nullability has to be handled the way
   `UnknownRequestKeys` already handles it with `NonNullable`.

## Acceptance criteria

- [ ] Misspelling any field of `FileCreateBody`, `FileUpdateBody` or
      `PermissionBody` fails `bun run typecheck` with the offending key in the
      message
- [ ] **Adding** a field inside `shortcutDetails` that the schema does not have
      fails the same way. Adding rather than renaming is the case that matters:
      a rename breaks the call sites and would look guarded when it is not
- [ ] `bun run test` and `bun run typecheck` pass with no other change
- [ ] The new check carries a comment saying what it covers that
      `GeneratedParamChecks` does not, as the three beside it do
- [ ] No docs change — this is invisible to a user

## Verification

- Automated: `bun run typecheck` is the test. The red step above, run by hand
  and recorded in the pull request, is what shows it can fail. `bun run test` —
  unchanged, and must stay green. `bun run test:e2e` — nothing.
- Manual, against a real account: none. The check runs entirely at compile time
  and never reaches Google.
