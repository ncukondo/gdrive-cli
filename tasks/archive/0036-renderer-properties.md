# Task 0036: The table stays a table, whatever a file is called

Status: closed unmerged — superseded by [0037](0037-machine-format-by-default.md)
and decision [0036](../decisions/0036-machine-format-by-default.md). Its pull
request #14 is closed without merging; see Outcome notes.
Depends on: 0034 — it derived the type column's width and added the docs
transcript test this task removes.
Parallel: yes (worktree-safe) alongside 0035, which touches only `.github/` and
the repo root. Not parallel with anything touching `commands/file-format.ts`.

## Goal

`ls` and `search` print a table whose columns line up for any name Drive
permits, and the renderer's tests are what say so.

## Context

- Decision: [`0035`](../decisions/0035-docs-are-downstream.md). §1 is the
  specification for the tests, §2 is why one existing test is deleted rather
  than fixed.
- The `Name` column has the defect the type column had before 0034, twice over.
  Measured against the real renderer:
  - A name of 27 or more UTF-16 units meets `NAME_W` exactly, so `padEnd` adds
    nothing and the ID abuts it: `…xxxxxxx1AbCdEf`. Where the name ends cannot
    be recovered by a reader or a script.
  - A full-width character costs one UTF-16 unit and two display columns, so a
    name containing `k` of them pushes everything right of it `k` columns out.
    `会議` drifts 2, `研修医へのフィードバックシート` drifts 15. Rows in one table
    disagree about where the ID column starts.
- Text is the default output ([`0007`](../decisions/0007-output-and-errors.md)),
  so this is what an agent calling `gdrive ls` gets unless it asks for `-f json`.
- 0034 fixed the same shape in the type column by deriving `TYPE_W` from the
  vocabulary. That trick is unavailable here: Drive decides how long a name is.
- East Asian Width is the standard that answers "how many columns does this
  character occupy" (Unicode Annex #11: `W` and `F` are two columns). Decide
  whether to depend on a package or implement the ranges; both are defensible,
  and [`0002`](../decisions/0002-tech-stack.md) is the record on adding a
  dependency.

## Scope

- `src/commands/file-format.ts` — the padding, and whatever computes display
  width.
- `src/commands/file-format.test.ts` — the properties.
- `tests/integration/docs-transcripts.test.ts` — **deleted** ([`0035`](../decisions/0035-docs-are-downstream.md) §2).
- `docs/commands.md` — only if a transcript's rendering actually changes.

## Out of scope

- **Generating transcripts from the code** — [`0035`](../decisions/0035-docs-are-downstream.md)
  "Out of scope".
- **Truncating or eliding long names.** That is a design change to the table and
  needs its own decision; this task makes the columns honest about what is
  there, whatever the width ends up being.
- The `info` detail renderer. Its labels are a closed ASCII set, so `LABEL_W` has
  neither defect.

## TDD plan

1. **Delete the wrong guard first**
   - Remove `tests/integration/docs-transcripts.test.ts`. Do this in its own
     commit, before writing anything else, so the diff shows the properties
     replacing it rather than accompanying it.

2. **The columns line up, for any name**
   - **Red** — a property over a set of names that must include: a plain ASCII
     name, a name of exactly `NAME_W` units, a name longer than that, a name of
     full-width characters, a mixed name, and a name containing an emoji. For
     every one, in a table also containing a short name, assert that the ID
     column begins at the same display offset on every row, and that at least one
     space separates every column. Assert on *display* offset, which means the
     test needs the same width function the renderer does — write the property
     against a small independent measure so the test cannot pass by sharing a bug
     with the code.
   - **Green** — pad by display width; decide what a name wider than the column
     does. Whatever you choose, it must keep the separator: a column that grows
     to fit is honest, a column that silently loses its boundary is not.
   - **Refactor** — one width function, used by every column that pads.

3. **The type column property survives**
   - 0034's property over `FILE_TYPES` must still pass, or be replaced by the
     stronger one from step 2 if it subsumes it. Do not simply delete it.

## Acceptance criteria

- [ ] `tests/integration/docs-transcripts.test.ts` no longer exists
- [ ] A table containing `研修医へのフィードバックシート` and `Budget` has its ID
      column at one display offset
- [ ] A name of exactly `NAME_W` units is still separated from its ID
- [ ] The type column property from 0034 still holds
- [ ] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check` pass
- [ ] `docs/commands.md` updated only if the rendering it shows actually changed

## Verification

- `bun run test src/commands/file-format.test.ts` — the properties
- Manual, against a real account: `gdrive ls` on a folder holding a Japanese
  file name, a 30-character ASCII name and a short one, in one listing. Read the
  output as a column of IDs and check it is a column. This is the only step that
  proves the display measure matches a real terminal.

## Outcome notes

Closed unmerged. The work was done, reviewed twice, and is what settled the
question against itself.

- The fix worked. Measured against a real account, the id column moved from
  display offsets `55, 59, -1, 55, 57, 70` to `60` on every row, and the `-1`
  was a row whose name and id could not be separated at all.
- Review then showed the guard could not hold. The test's "independent" oracle
  was a closed allowlist, so it returned 1 for anything unlisted exactly as the
  renderer's ranges did, and a fixture of two characters neither knew passed the
  property while rendering a column out of line. The range data itself was wrong
  for 214 assigned code points.
- Regenerating from `EastAsianWidth-17.0.0.txt` fixed the data and exposed the
  real problem: for `U+4DC0..4DFF` the standard says two columns while
  `Bun.stringWidth` and `string-width@5` both say one. Depending on the ecosystem
  package would have been worse than the hand-written table, not better — it is
  stale in the same places. There is no correct answer to import.
- That is the measurement behind
  [`0036`](../decisions/0036-machine-format-by-default.md): alignment is not a
  defect to fix but a cost to stop paying. Task 0037 removes the renderers this
  task was repairing.
- One commit of #14 is salvaged by 0037 — deleting
  `tests/integration/docs-transcripts.test.ts`, which
  [`0035`](../decisions/0035-docs-are-downstream.md) §2 requires regardless.
