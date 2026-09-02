# Task 0053: A listing says when it stopped early

Status: todo
Depends on: —
Parallel: no — it owns `src/lib/api.ts`'s pagination, which task 0050 also
edits (the body types). Land 0050 first, or rebase.

## Goal

`cp -r` fails rather than reporting a partial copy as a success when a folder's
listing is cut short, and `ls` / `search` say when theirs was (issue #32).

## Context

- Relevant decisions:
  [`0060`](../decisions/0060-a-listing-says-when-it-stopped.md) (the position,
  and why the three callers differ),
  [`0031`](../decisions/0031-recursive-copy.md) §3–§4 (the guarantee this
  protects), [`0014`](../decisions/0014-pre-1.0-compatibility.md) and
  [`0034`](../decisions/0034-file-types-are-what-commands-act-on.md) §3 (adding
  an error code is a minor break).
- `collectPages` (`src/lib/api.ts`) stops after `MAX_PAGES = 100` and returns
  what it has. `pageSize` is 100, so the bound is 10,000 children.
- Three callers: `listChildren` (used by `ls` **and** by `cp -r`'s walk in
  `src/lib/copy-tree.ts`), `searchFiles`, and the permissions listing, which
  has its own loop with the same cap.
- A `--limit` that stops the walk is **not** truncation. That distinction is the
  one most likely to be got wrong, because both exit the loop early.

## Scope

- `src/lib/api.ts` — `collectPages`, `listChildren`, `searchFiles`, `MAX_PAGES`,
  `pageSize`
- `src/lib/copy-tree.ts` — the walk's reaction
- `src/types/index.ts` — the `LISTING_INCOMPLETE` code and its exit mapping
- `src/commands/drive-read.ts` — `ls` and `search` output
- the tests beside each, and `tests/helpers/fake-drive.ts` if a fake has to be
  able to truncate
- `docs/commands.md` — the field, the code, the number

## Out of scope

- Resuming a `cp -r` that stopped. [`0031`](../decisions/0031-recursive-copy.md)
  defers it in its own `Out of scope`, and this task does not change that.
- Paginating the permissions listing differently. It has the same cap and no
  reported case; a file with 10,000 permissions is not a thing anyone has hit.
  **This work will not be done**, and no issue is opened for it.

## TDD plan

1. **Red** — `src/lib/api.test.ts`: a fake Drive that returns a `nextPageToken`
   for ever. `listChildren` reports `complete: false` and returns the rows it
   got; a fake that runs out of pages reports `complete: true`; and a
   `--limit` that stops early reports `complete: true`, because the caller
   asked for that many.
2. **Red** — `src/lib/copy-tree.test.ts`: a walk over a folder whose listing is
   truncated fails with `LISTING_INCOMPLETE`, names the folder, and carries the
   0031 §4 payload for what it had already copied. Assert the payload, not the
   message.
3. **Red** — `src/commands/drive-read.test.ts`: `ls` over a truncated listing
   exits 0, emits `complete: false`, and prints a note in text mode. `-q` is
   unchanged — a note is not a value.
4. **Green** — `collectPages` returns the flag; `pageSize` becomes 1000.
5. **Refactor** — the permissions loop repeats `MAX_PAGES` by hand. Leave it
   repeated unless sharing it reads as one idea.

## Acceptance criteria

- [ ] `cp -r` over a folder whose listing truncates exits non-zero with
      `LISTING_INCOMPLETE` and reports what it copied
- [ ] `ls` and `search` emit `complete` and still exit 0
- [ ] `-n 5` on a folder of 20 reports `complete: true`
- [ ] `pageSize` is 1000, so a 1,000-child folder is one round trip
- [ ] `bun run test` and `bun run typecheck` pass
- [ ] `docs/commands.md` names the field, the code and 100,000

## Verification

- Automated: `bun run test src/lib tests/integration` — the flag, the walk's
  failure, and the two renderings. `bun run test:e2e` — **one new case**: `ls`
  of an ordinary folder reports `complete: true` against the real API. The
  truncated case cannot be made live without creating 100,001 files, and saying
  that plainly is better than a case that only ever proves the easy half.
- Manual, against a real account: none. Nothing here needs a person, and the
  live half that is reachable is in the suite.
