# Task 0024: `docs insert --before` / `--after <marker>`

Status: done
Depends on: 0023 — the marker search is the helper 0023 builds for
`replace --as markdown` (decision 0022 §3); starting earlier would write it
twice.
Parallel: no — same files as 0023.

## Goal

`gdrive docs insert <doc> @draft.md --before "<!-- schedule -->"` puts the
content at the placeholder without anyone computing a character index, and
without the `replace`-with-the-marker-repeated trick.

## Context

- [issue #7](https://github.com/ncukondo/gdrive-cli/issues/7), which documents
  the trick this replaces.
- Relevant decisions: `decisions/0022` (this change), `decisions/0021` §6 (the
  marker walk and why table cells are excluded), `decisions/0009` (the
  positioning options this extends).
- Relevant docs: `docs/commands.md` §`gdrive docs insert`.
- `resolveInsertIndex` in `src/commands/docs/insert.ts` is the function that
  grows; it already receives the fetched `DocumentRaw`.

## Scope

- `src/commands/docs/insert.ts` + `insert.test.ts`.
- `src/commands/docs/index.ts` — two more options on the command.
- `src/lib/docs-api.ts` — the shared marker search, if 0023 left it private.
- `decisions/README.md`, `docs/commands.md`.

## Out of scope

- `--occurrence <n|all>`, regex markers, markers on `append` or `sheets`
  (decision 0022 §"Out of scope").
- Removing the marker after inserting — that is `replace`.

## TDD plan

1. **Red** (`insert.test.ts`)
   - `--before <marker>` resolves to the marker's start index, `--after` to its
     end index, and the text lands there;
   - zero matches → `NOT_FOUND` naming the marker;
   - two matches → `INVALID_ARGS` reporting the count;
   - `--match-case` narrows a two-match case to one, and its absence matches
     case-insensitively (the same default as `replace`);
   - a marker only present inside a table cell counts as zero matches;
   - `--before` together with `--index` or `--at` → `INVALID_ARGS`, and the
     existing "specify a position" error still fires with none of the four.
2. **Green** — extend `resolveInsertIndex` (it becomes async) and reuse the
   shared search.
3. **Refactor** — the four positions resolve through one `switch`-shaped
   function, not four nested `if`s; `insert.ts` stays under the size where its
   position logic wants its own module.

## Acceptance criteria

- [x] `insert --before` / `--after` place content at a marker, with Markdown
      structure (0023) intact
- [x] Ambiguous and missing markers are distinct, actionable errors
- [x] The existing three positions and their errors are unchanged
- [x] `bun run typecheck` / `lint` / `lint:casts` / `format:check` / `test:unit`
- [x] `docs/commands.md` documents the two options and the exactly-once rule,
      and drops the `replace`-as-insertion workaround note

## Outcome notes

- `resolveInsertIndex` stayed synchronous. The task and decision 0022 both
  expected it to go async for the document read; it did not need to, because
  the command already fetches the document for `--at end` and `findMarkerRanges`
  is a pure function over it. Decision 0022's consequence is corrected.
- The manual pass found the one thing the unit tests could not have: **a marker
  is document text, not Markdown source.** `--after "## 次回"` finds nothing,
  because the document holds `次回` carrying a heading style. Documented next to
  the options.
- The fixture used for the tests deliberately makes `HERE` ambiguous
  case-insensitively (a cell holding `HERE`, and a `here` in a later paragraph),
  which is what pins both the ambiguity error and the table-cell exclusion.
- `--match-case` is named in the ambiguity message only when it is not already
  on, so the suggestion is never one the caller has already taken.

## Verification

- `bun run test:unit` — 490 passed; `typecheck`, `lint`, `format:check` clean.
- **Manual, against a real account**: a document with a `<!-- schedule -->`
  placeholder took a Markdown table via `insert --before`; `docs read` showed the
  table in front of the marker with the marker intact, and `--after "次回"`
  appended to a heading in place. The error paths were exercised live too — a
  missing marker exits 1 with `No such marker in the document: "…"`, an
  ambiguous one exits 3 with `matches 2 times`, and `--before` with `--at` exits
  3. The test document was trashed afterwards.
