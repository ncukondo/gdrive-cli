# Task 0024: `docs insert --before` / `--after <marker>`

Status: todo
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

- [ ] `insert --before` / `--after` place content at a marker, with Markdown
      structure (0023) intact
- [ ] Ambiguous and missing markers are distinct, actionable errors
- [ ] The existing three positions and their errors are unchanged
- [ ] `bun run typecheck` / `lint` / `lint:casts` / `format:check` / `test:unit`
- [ ] `docs/commands.md` documents the two options and the exactly-once rule,
      and drops the `replace`-as-insertion workaround note

## Verification

- `bun run test src/commands/docs/insert.test.ts`.
- **Manual**: insert the issue's table at a `<!-- schedule -->` placeholder in a
  real document, then `docs read` and confirm the table sits where the marker
  was and the marker is still there.
