# Task 0046: A `create` that fails leaves nothing in My Drive's root

Status: todo (move to `tasks/archive/` when done)
Depends on: 0045 — it touches no file 0045 owns, but 0045's `forms.test.ts` and
`slides.test.ts` document this hazard, and the sentences they carry become wrong
when this lands. Land after it, and correct them here.
Parallel: no — it edits all four `create` commands, which nothing else should be
editing at the same time.

## Goal

`gdrive docs|sheets|forms|slides create --parent <folder>` never leaves a file
in My Drive's root, whatever fails.

## Context

- Issue: [#36](https://github.com/ncukondo/gdrive-cli/issues/36).
- All four commands are create → fill → move, because
  `documents.create`, `spreadsheets.create`, `forms.create` and
  `presentations.create` each take a title and ignore any parent.
  [`0028`](../decisions/0028-forms-write.md)'s note on `moveFile` says so, and
  `src/commands/forms/create.ts`'s comment names the other three as having the
  same shape for the same reason.
- So a failure **between** create and move leaves the file in My Drive's root,
  named as asked, and the command reports failure without naming it. For a form
  or a deck that failure is easy to reach: the fill is one `batchUpdate`, which
  is atomic, so a single item the API refuses fails it after the file exists.
- **This breaks the containment the live suite rests on.**
  [`0043`](../decisions/0043-e2e-runs-before-push.md) §2 is one invariant — every
  write goes inside a sandbox — and this path writes outside it no matter what a
  test does. `.husky/pre-push` runs that suite on every push, so the exposure is
  recurring rather than theoretical. The review of task 0045 traced two concrete
  reverts that each orphan a form.
- [`0031`](../decisions/0031-recursive-copy.md) §3–§4 gave the error envelope an
  optional `data`, on the general ground that `success: false` must stop implying
  nothing happened. This is the second command family to need it.

**No new decision is needed.** The move-first ordering is an implementation
choice inside what 0028 already describes, and the envelope is already general.
If the work turns out to need a position nobody has taken, stop and say so
rather than deciding it here.

## Scope

- `src/commands/docs/create.ts`, `sheets/create.ts`, `forms/create.ts`,
  `slides/create.ts` and their tests.
- `tests/e2e/forms.test.ts` and `slides.test.ts` — the docblocks 0045 wrote about
  this hazard. They become false when this lands, and a false docblock is what
  three reviews in this repository have now found.
- `docs/commands.md` where any `create` describes what a failure leaves behind.

## Out of scope

- **Deleting the file on failure.** Named and refused in
  [#36](https://github.com/ncukondo/gdrive-cli/issues/36): it turns one failure
  into two, and a delete that fails leaves the same orphan plus a misleading
  message.
- **`upload`, `mkdir`, `cp`, `ln`.** Each takes a parent in the request that
  creates the file, so none of them has this shape. Check that before trusting
  this line.

## TDD plan

1. **Move before fill**
   - **Red**, per command — with `--parent`, the move is issued **before** the
     fill; when the fill then fails, the file is in the parent and not in the
     root. Assert the call order, not just that both happened.
   - **Red** — without `--parent`, nothing changes: two calls, no move.
   - **Green** — reorder each.
2. **The failure names what exists**
   - **Red** — a fill that fails after the file exists reports the id through the
     envelope's `data`, so a caller can find and delete it. Follow what
     `cp -r` does with the same field rather than inventing a second shape;
     `src/lib/copy-tree.ts` and `src/types/index.ts` are the precedent.
   - **Green** — implement.
3. **Refactor** — the four commands should not each grow their own copy of this.
   If a shared helper falls out, take it; if it does not, say why in the report.

## Acceptance criteria

- [ ] Each of the four `create`s with `--parent` moves the file into the parent
      before filling it
- [ ] A fill that fails leaves the file **in the parent**, and the failure names
      its id in `data`
- [ ] Without `--parent`, the call sequence is unchanged
- [ ] `tests/e2e/forms.test.ts` and `slides.test.ts` no longer describe a hazard
      that no longer exists
- [ ] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check` pass
- [ ] `docs/commands.md` updated where it describes a failed `create`

## Verification

Two lists, kept apart so that "the automated one passed" cannot stand in for the
part it never ran (`decisions/0043` §4).

- Automated: `bun run test src/commands` — the four commands. `bun run test:e2e`
  — the existing suite must stay green; this task adds no e2e file, but it is the
  suite whose containment the change exists to restore.
- Manual, against a real account: make a `forms create --file` fail on its fill —
  a document with an `other: true` option and a `value` beside it will do, or any
  item the API refuses — and confirm the form is **in `--parent`**, that the
  error names its id, and that `gdrive rm <that id>` removes it. Then check My
  Drive's root is untouched. Repeat for `slides create --file` with an unknown
  layout, which is the deck's version of the same failure and is reachable
  without editing any code.
