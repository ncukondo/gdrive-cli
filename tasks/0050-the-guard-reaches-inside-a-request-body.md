# Task 0050: The generated-type guard reaches inside a Drive `requestBody`

Status: todo
Depends on: —
Parallel: yes (worktree-safe) — beside 0049, 0051 and 0052; it owns
`src/lib/google-clients.ts` and `src/lib/api.ts`'s body types.

## Goal

A field this CLI puts inside a Drive `requestBody` fails `bun run typecheck`
when googleapis no longer has it, the way a Docs, Forms or Slides request field
already does (issue #29) — and the assertions beside it stop claiming a check
they do not perform.

## Context

- Relevant decisions: [`0015`](../decisions/0015-no-type-assertions.md) (why
  these checks exist at all), [`0026`](../decisions/0026-ln.md) §6 — which
  claims the guard already covers this. It does not; issue #29 is the
  correction, and per
  [`0032`](../decisions/0032-decisions-are-append-only.md) §3 that record is not
  edited and gains no back-pointer.
- `GeneratedParamChecks` compares only the *top-level* keys of each call's
  params. `requestBody` is one such key, so everything inside it is invisible.
- The three Drive bodies are `FileCreateBody`, `PermissionBody`, and
  `files.update`'s, which is declared **inline** in the port and therefore
  cannot be named by any check. Naming it is part of the work, not tidying.
- **Two things found while implementing, both of which change the plan.**

  1. `UnknownRequestKeys` could not do this job as written. It read
     `keyof T[K]` on our side without `NonNullable`. For an *optional* field
     `T[K]` is `X | undefined` and `keyof` of that is `never`, so the inner keys
     were compared against nothing and every one passed — and
     `shortcutDetails?:` is optional, so the field issue #29 names is the one
     the check would still have missed. The generated side already had
     `NonNullable` for the same reason one number over. Both sides have it now.
     Side effect: the Docs, Forms and Slides checks were doing their inner half
     only because their union members declare each key as **required**. An
     optional member added to any of them was silently exempt.
  2. **`X extends Schema ? true : never` asserts nothing.** A tuple element that
     evaluates to `never` is legal TypeScript. Measured: inserting
     `string extends number ? true : never` into `DocsRequestChecks` compiles
     clean. All three existing checks have carried an inert line since task
     0016, and copying it three more times would have added a comment vouching
     for a check that cannot fail — which is worse than no check, because it is
     believed. Replaced with `type AssertAssignable<T extends S, S> = T`, which
     errors on the constraint.

## Scope

- `src/lib/google-clients.ts`
- `src/lib/api.ts` — naming `files.update`'s inline body, and any body type that
  turns out to disagree with the schema

## Out of scope

- A second level down. `insertText: { location: { index } }` — `location`'s own
  keys stay unchecked, in the new guard and in the three beside it. **This work
  will not be done**: every body here is one level deep, and a recursive check
  would be written against no case that needs it.
- Widening the guard to Sheets `requestBody`s or to the `media` half of an
  upload. Not surveyed; adding an unexamined check is how a guard gets disabled
  later. A gap found while doing this goes in a comment on issue #29.

## TDD plan

There is no runtime behaviour here, so the red step is a type error rather than
a failing test — the shape task 0016 used for the checks this extends. Every
probe below is introduced alone, `bun run typecheck` run, and the result
recorded in the pull request.

1. **Red** — confirm each of these compiles **clean** today: a bogus top-level
   key on each of the three bodies; a key *added* inside `shortcutDetails`; a
   false `extends` assertion inside `DocsRequestChecks`.
   *Adding* rather than renaming is the case that matters — a rename breaks the
   call sites and would look guarded when it is not.
2. **Green** — `NonNullable` on both sides of `UnknownRequestKeys`;
   `AssertAssignable` in place of the six inert `extends` lines; `DriveBodyChecks`
   for the three bodies; `FileUpdateBody` named in `api.ts`.
3. **Refactor** — every comment states what is actually checked. In particular
   nothing may claim the guard catches a *misspelling* of an existing field:
   a rename is caught by the call sites, and what the guard adds is the **added**
   key nothing else sees.

## Acceptance criteria

- [ ] A bogus top-level key on `FileCreateBody`, `FileUpdateBody` or
      `PermissionBody` fails `bun run typecheck` naming the key
- [ ] A key **added** inside `shortcutDetails` fails the same way
- [ ] A false `extends` pairing in any of the six assertion sites now fails
- [ ] An *optional* member added to `DocsRequest` with a bogus inner key fails
- [ ] `bun run test` and `bun run typecheck` pass with no other change
- [ ] No comment claims a check the probes above do not demonstrate
- [ ] No docs change — this is invisible to a user

## Verification

- Automated: `bun run typecheck` is the test; the probe table in the pull
  request is what shows it can fail. `bun run test` — unchanged, and must stay
  green. `bun run test:e2e` — nothing.
- Manual, against a real account: none. The check never reaches Google.
