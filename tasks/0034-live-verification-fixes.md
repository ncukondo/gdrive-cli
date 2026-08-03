# Task 0034: What the live verification found

Status: todo (move to `tasks/archive/` when done)
Depends on: 0027, 0029 — both merged; this fixes what running them against a
real account showed.
Parallel: no — it touches `lib/api.ts`, `types/index.ts` and
`commands/file-format.ts`, which is the same intersection 0027 owned.

## Goal

Three things a real Drive showed that no fake could: a table column that
collides, a documented transcript that is wrong, and a form that has no name for
what it is.

## Context

Tasks 0027 and 0029 shipped with their manual verification unrun, and both
archive notes say so. Running it found one defect each and one gap between them.

- **The column.** `TYPE_W` is 8 and `"shortcut"` is eight characters, so
  `padEnd` adds nothing and the type runs into the timestamp:
  `shortcut2026-08-03 04:51  link-to-form`. Every other member is at most six
  characters, which is why the table was right until 0027 added a seventh.
- **The transcript.** `docs/commands.md`'s Shortcuts section omits the `Link:`
  line from `info`'s output. Task 0027 left it out deliberately, reasoning that
  inventing a URL would be worse than omitting one, because nothing had confirmed
  what Drive returns for a shortcut. Drive returns one:
  `https://drive.google.com/file/d/<shortcut id>/view?usp=drivesdk`, pointing at
  the shortcut rather than the target. The caution was right and the answer is
  now known.
- **The type.** A form reads as `type: file`, and `ls --type` cannot find one.
  Decision [`0034`](../decisions/0034-form-is-a-file-type.md) settles the rule —
  a type exists when a command can act on it — and `forms read` shipping is what
  makes a form qualify. 0034 deliberately does *not* list the membership; the map
  in `lib/api.ts`, the union in `types/index.ts` and `docs/commands.md` are the
  three places that hold it, and this task is where all three change together.
  §2 is the part to not overreach on: the label is not a capability.

Also relevant: [`0008`](../decisions/0008-drive-commands.md) (the file object and
`--type`), [`0014`](../decisions/0014-pre-1.0-compatibility.md) (§3 of 0034 makes
this a minor bump with a release note), [`0025`](../decisions/0025-shortcuts.md)
(the `target_type` label runs through the same map).

## Scope

- `src/commands/file-format.ts` — `TYPE_W`.
- `src/types/index.ts` — `FileType` gains `form`.
- `src/lib/api.ts` — `MIME_TYPE_MAP` gains the form MIME; `typeFilterClause`
  and `VALID_TYPES` follow.
- `src/commands/{ls,search}.ts` — `form` among the accepted `--type` values.
- `docs/commands.md`, `README.md`.

## Out of scope

- A type for any other unmodelled Workspace MIME — 0034 "Out of scope".
- Anything about what `download` or `cp` do to a form. 0034 §2.

## TDD plan

1. **The column fits every type**
   - **Red** — `formatFileTable` on a list containing a `shortcut` puts at least
     one space between the type and the timestamp. Write it as a property over
     *every* `FileType` member, not a literal for `shortcut`, so the next member
     added cannot reintroduce this.
   - **Green** — widen `TYPE_W`.
   - **Refactor** — if the width is derived from the vocabulary rather than
     written down, the test above becomes structural. Prefer that.

2. **A form knows what it is**
   - **Red** — `normalizeFile` on a raw form yields `type: "form"`; a shortcut
     to a form yields `target_type: "form"`; `typeFilterClause("form")` emits the
     form MIME clause; `ls --type form` and `search --type form` are accepted and
     an unknown `--type` lists `form` among the choices.
   - **Green** — add the MIME to the map and `form` to the union and
     `VALID_TYPES`.
   - **Refactor** — none expected; the map is the single point (0025 §2).

3. **Docs**
   - `docs/commands.md` — the `info` transcript in the Shortcuts section gains
     its `Link:` line exactly as rendered, `--type` lists `form`, and the file
     object's `type` list gains it.
   - `README.md` — wherever the type vocabulary appears.
   - No decision file is edited
     ([`0032`](../decisions/0032-decisions-are-append-only.md)).

## Acceptance criteria

- [ ] `gdrive ls --type shortcut` prints a table whose columns line up
- [ ] `gdrive info <form>` reports `Type: form`, and a shortcut to one reports
      `Target: <id> (form)`
- [ ] `gdrive ls --type form` lists the forms in a folder
- [ ] An unknown `--type` names `form` among the valid choices
- [ ] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check` pass
- [ ] `docs/commands.md` and `README.md` updated, in the same pull request as the
      code ([`0033`](../decisions/0033-implementation-lands-through-review.md) §1)

## Verification

- `bun run test src/commands/file-format.test.ts` — the column, over every type
- `bun run test src/lib/api.test.ts` — the map, the filter clause, the target label
- Manual, against a real account: this task exists because the last two skipped
  it. Create a form and a shortcut to it, then run `ls --type form`,
  `ls --type shortcut`, `info` on both, and compare `info`'s output against the
  transcript in `docs/commands.md` line for line.
