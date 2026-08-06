# Task 0044: A name this CLI cannot address is refused

Status: todo (move to `tasks/archive/` when done)
Depends on: 0033 and 0043 — both are in review and both touch the commands this
task changes (`cp.ts`, `rename.ts`). Start after they merge, or the branch will
fight them.
Parallel: no — it edits nearly every command that writes, so it collides with
anything else that does.

## Goal

Every command that gives a file a name refuses one this CLI could not then find
by path, before it writes anything.

## Context

- Decision: [`0055`](../decisions/0055-a-name-has-to-be-addressable.md). §1 is
  the rule and its two cases, §2 says the check is pre-flight, §3 says Drive's
  tolerance of duplicates is not adopted and why.
- It subsumes [`0054`](../decisions/0054-a-copy-keeps-its-name.md) §3, whose
  `cp`-shaped version task 0033 implemented as `refuseSibling` in
  `src/commands/cp.ts`. **Read that function first** — the generalization is
  mostly moving it, including its handling of the `/` root alias, which is the
  part most likely to be lost in a rewrite.
- `src/lib/resolve-path.ts` is what defines "cannot survive a path": it trims
  each segment and splits on `/`. The refusal has to match what that function
  actually does, not what this task says it does — read it.
- The harm is visible in `resolve-path.ts`'s ambiguous-segment branch: two files
  with one name make an `INVALID_ARGS` for **both**.

## Scope

- A new shared helper — `src/lib/names.ts` or similar — holding both checks, so
  no command carries its own copy. Every command below calls it.
- `src/commands/rename.ts`, `cp.ts`, `mkdir.ts`, `upload.ts`, `ln.ts`, and the
  `create` in each of `docs/`, `sheets/`, `forms/`, `slides/`.
- `src/commands/cp.ts` — `refuseSibling` folds into the shared helper. Do not
  leave two implementations.
- `docs/commands.md`, `README.md`.

## Out of scope

- **A `--force`.** [`0055`](../decisions/0055-a-name-has-to-be-addressable.md)'s
  `Out of scope` refuses it; do not add one.
- **Finding the duplicates an account already has.** Same section, same answer.
- **`mv`.** It moves rather than duplicates, so it cannot create a sibling
  collision — but check that claim against the code before trusting this line,
  because a move into a folder that already holds that name does exactly what
  §1 forbids. If it does, `mv` is in scope after all and this bullet is wrong.

## TDD plan

1. **The helper**
   - **Red** — a name that is already a sibling's; a name that differs from its
     own trim; a name holding `/`; a name that is fine. Each names what is wrong
     and what to pass instead.
   - **Green** — implement, with the sibling query taking the destination folder
     id so every caller can supply one.
2. **The commands, one at a time**
   - **Red**, per command — the refusal is `INVALID_ARGS`, and **no write call is
     made at all**. Assert the client was never asked, not merely that nothing
     changed; §2's whole point is that the check precedes the write.
   - **Red** — `cp --name <the source's own name>` into the source's own folder
     is refused, which 0054 §3's wording had allowed.
   - **Green** — wire each one.
3. **Refactor** — `refuseSibling` is gone from `cp.ts`, and the `/` alias
   handling lives in the helper with its own test.

## Acceptance criteria

- [ ] Each of `rename`, `mkdir`, `upload`, `cp`, `ln` and the four `create`s
      refuses a name a sibling already holds, with `INVALID_ARGS`, naming the
      remedy, and issuing no write
- [ ] The same for a name that will not survive a path — a leading or trailing
      space, or a `/`
- [ ] `cp --name` is not an exemption
- [ ] The `/` root alias is still handled, on both sides
- [ ] One implementation of the check, not nine
- [ ] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check` pass
- [ ] `docs/commands.md` and `README.md` updated

## Verification

Two lists, kept apart so that "the automated one passed" cannot stand in for the
part it never ran (`decisions/0043` §4).

- Automated: `bun run test src/lib/names.test.ts src/commands` — the helper and
  every caller. `bun run test:e2e` — nothing; this task adds no e2e file.
- Manual, against a real account: create two files whose names would collide and
  confirm the second is refused **and does not exist afterwards** — a listing,
  not just an exit code, because the failure this prevents is one where the write
  happened anyway. Then rename a file to a name a sibling holds, and try a
  trailing space, and confirm in each case that the file is still findable by its
  original path. Do it once in My Drive and once on a shared drive, since the two
  reach `resolve-path.ts` by different routes.
