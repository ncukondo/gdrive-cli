# Task 0054: A copied question keeps all of its navigation or none

Status: todo
Depends on: —
Parallel: yes (worktree-safe) — beside 0053; it owns `src/commands/forms/` and
`tests/e2e/forms.test.ts`, which 0053 does not touch.

## Goal

`gdrive forms create --file` can copy an ordinary branching form, instead of
having the whole `batchUpdate` refused by the API (issue #37).

## Context

- Relevant decisions:
  [`0061`](../decisions/0061-navigation-is-all-or-nothing.md) (the position, and
  why the question is created rather than skipped),
  [`0028`](../decisions/0028-forms-write.md) §1 (why the id is stripped at all),
  [`0012`](../decisions/0012-testing-strategy.md) (why the proof is live).
- `withoutSectionTargets` in `src/commands/forms/plan.ts` drops
  `goToSectionId` and keeps `goToAction`. The API requires navigation to be
  all-or-nothing within one option list and refuses the batch outright:
  `Invalid Options, Either all or no options should be go to enabled`.
- **The failing shape is the ordinary one.** In the Forms editor, turning on
  "go to section based on answer" gives every option a target, and the ones that
  continue get `goToAction: NEXT_SECTION`. So a real branching question always
  mixes the two, and stripping only the ids always leaves it half navigated.
- An option list that uses **only** `goToAction` carries no id, is already
  uniform, and must be left alone. Stripping it would lose real navigation to
  fix a problem that list does not have.
- `tests/e2e/forms.test.ts`'s copy fixture branches uniformly and says why. That
  comment is the record of this gap and goes when the gap does.

## Scope

- `src/commands/forms/plan.ts`, `src/commands/forms/plan.test.ts`
- `src/commands/forms/create.test.ts`
- `tests/e2e/forms.test.ts`
- `docs/commands.md` — the `forms create` section

## Out of scope

- Carrying the **section structure** across a copy, so that branching could be
  rebuilt rather than dropped. That is a different and much larger thing — a
  copy would have to create the sections first and then rewrite every target to
  the new ids. **Not done here**; tracked by issue #37, which stays open for it
  if anyone asks. If nobody does, it is disowned at archive time.
- Anything on the `write` path. There the ids are the form's own and must not be
  stripped; only `create --file` (`ignoreIds`) is affected.

## TDD plan

1. **Red** — `src/commands/forms/plan.test.ts`, with a fixture whose option list
   mixes a `goToSectionId` and a `goToAction: NEXT_SECTION`: the created item's
   options carry **neither** field. Assert on the request body, because the
   defect is an encoding the API refuses and a fake accepts — which is the
   class task 0045 exists for.
2. **Red** — a list whose options carry only `goToAction` keeps every one of
   them. This is the test that stops the fix from becoming "strip navigation".
3. **Red** — the skipped report still names the item, with
   `kind: "option.goToSectionId"` unchanged (0061 §3).
4. **Red** — `tests/e2e/forms.test.ts`: a **mixed** copy fixture, live. This is
   the case that could not be written while the gap was open, and it is the only
   thing that proves the fix, because the constraint is the API's and no fake
   knows it.
5. **Green** — drop `goToAction` in the same pass that drops a `goToSectionId`,
   per option list rather than per option.
6. **Refactor** — the e2e fixture's uniform-branching comment goes.

## Acceptance criteria

- [ ] Copying a form whose question mixes `goToSectionId` and `goToAction`
      succeeds, and the copy has that question with all its options
- [ ] A question navigating only with `goToAction` keeps it
- [ ] The skipped report still names what was lost
- [ ] `bun run test` and `bun run typecheck` pass
- [ ] `bun run test:e2e` passes against a real account, including the new case
- [ ] `docs/commands.md` says a copy loses branching, and that the section
      structure is not carried either

## Verification

- Automated: `bun run test src/commands/forms`. **`bun run test:e2e` is the one
  that matters** — the unit tests can only assert what this branch believes the
  API wants, and the API is what refused the old encoding.
- Manual, against a real account: copy a real branching form from the Forms
  editor and open the copy in the editor, to confirm the questions are all there
  and no branching was silently half-applied. The live suite asserts the request
  is accepted; only a person can see the result is a usable form.
