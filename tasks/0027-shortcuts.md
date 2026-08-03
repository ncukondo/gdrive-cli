# Task 0027: Shortcuts resolve by argument role

Status: todo (move to `tasks/archive/` when done)
Depends on: —
Parallel: no — touches `lib/api.ts`, `lib/resolve-path.ts`, and all five command
registries, which is the intersection of every other file-taking task.

## Goal

A Drive shortcut stops being an invisible plain file: paths walk through folder
shortcuts, content commands read the target, entry commands keep acting on the
shortcut itself, and `info`/`ls` report `type: shortcut` with `target_id` /
`target_type`.

## Context

- Decision: [`0025`](../decisions/0025-shortcuts.md) — the role table in §1 is
  the specification; implement it argument by argument, not command by command.
- Also relevant: [`0008`](../decisions/0008-drive-commands.md) (addressing and
  the file object), [`0012`](../decisions/0012-testing-strategy.md) (client
  injection), [`0014`](../decisions/0014-pre-1.0-compatibility.md) (the
  `FileType` change is a minor bump with a release note).
- Docs: `docs/commands.md` (file object, `--type`, per-command reference),
  `README.md` (highlights).
- The shortcut MIME is `application/vnd.google-apps.shortcut`; the target lives
  in `shortcutDetails.targetId` / `shortcutDetails.targetMimeType`, which
  `FILE_FIELDS` does not currently request.

## Scope

- `src/types/index.ts` — `FileType` gains `shortcut`; `DriveFile` gains
  `target_id` / `target_type`.
- `src/lib/api.ts` — `FILE_FIELDS`, `DriveFileRawSchema`, `MIME_TYPE_MAP`,
  `normalizeFile`, `typeFilterClause`.
- `src/lib/resolve-path.ts` — intermediate-segment following; `resolveTarget`.
- `src/commands/{drive-read,drive-write}.ts`, `src/commands/{docs,sheets,share}/index.ts`
  — wire each argument to `resolvePath` or `resolveTarget` per the role table.
- `src/commands/{mv,cp}.ts` — a second dep for the destination argument.
- `src/commands/{ls,search}.ts` — `shortcut` in `VALID_TYPES`.
- `src/commands/file-format.ts` — `info` detail shows the target.
- `tests/helpers/fake-drive.ts` — nodes can be shortcuts.

## Out of scope

- Creating shortcuts (`gdrive ln` or equivalent) — 0025 "Out of scope", its own
  decision and task.
- `--follow` / `--no-follow`, and a `link -> target` column in `ls` text output
  — both deferred in 0025.

## TDD plan

Five sub-features; commit at each green point.

1. **The file object knows a shortcut** (`lib/api.ts`, `types/`)
   - **Red** — `normalizeFile` on a raw shortcut yields `type: "shortcut"`,
     `target_id`, `target_type` from `targetMimeType`; a non-shortcut yields
     `null` for both; a shortcut whose `targetMimeType` is unknown yields
     `target_type: "file"`; `typeFilterClause("shortcut")` emits the MIME
     clause.
   - **Green** — extend `FILE_FIELDS`, the raw zod schema, `MIME_TYPE_MAP`,
     `normalizeFile`, `typeFilterClause`.
   - **Refactor** — keep the target-type lookup on the existing `mimeToType`
     rather than a second map.

2. **Intermediate segments follow** (`lib/resolve-path.ts`)
   - **Red** — `Reports/link-to-2026/summary`, where `link-to-2026` is a
     shortcut to a folder holding `summary`, resolves to `summary`'s id. A
     `drive:` path does the same. Two shortcuts in a row *as separate segments*
     both resolve. A shortcut segment whose target is a Doc, with a segment
     after it, still errors `NOT_FOUND` naming that segment.
   - **Green** — `childrenNamed` requests `shortcutDetails`, and the walk
     continues from `target_id` when a matched segment is a shortcut.
   - **Refactor** — the candidate type carries the target, so the walk has one
     branch, not a re-fetch.

3. **`resolveTarget`** (`lib/resolve-path.ts`)
   - **Red** — a path to a shortcut returns the target id with `file: null`; a
     path to an ordinary file returns its id unfollowed; a bare id calls
     `files.get` once and returns the fetched `DriveFile` in `file`; a bare id
     that is a shortcut returns the target id *and* the shortcut's `file`;
     `resolvePath` on the same shortcut path still returns the shortcut's id.
   - **Green** — implement, sharing the walk with `resolvePath`.
   - **Red/Green (errors)** — target `files.get` 404s → `NOT_FOUND` whose
     message contains `Shortcut` and the argument as typed; shortcut MIME with
     no `targetId` → `API_ERROR`; target is itself a shortcut → `API_ERROR`
     (one hop, 0025 §5).

4. **Wiring the role table** (registries, `mv`/`cp`, `ls`/`search`)
   - **Red** — per command, with a fake whose `files.get`/`files.list` record
     which id each API method received:
     - follows: `ls <shortcut-to-folder>` lists the target's children;
       `download`, `docs read`, `sheets read` hit the target id; `--parent`
       on `mkdir`/`upload`/`docs create`/`sheets create` creates in the target;
       `mv a link-to-folder` and `cp a link-to-folder` land in the target.
     - does not follow: `rm <shortcut>` trashes the shortcut id; `mv <shortcut>
       dest` and `cp <shortcut> dest` move/copy the shortcut; `share add
       <shortcut>` permissions the shortcut; `info <shortcut>` reports
       `type: shortcut` with the target fields.
     - `--type shortcut` is accepted by `ls` and `search`; an unknown `--type`
       still errors listing `shortcut` among the choices.
   - **Green** — swap the registry call sites; give `mv`/`cp` a
     `resolveFolder` dep; add `shortcut` to `VALID_TYPES`.
   - **Refactor** — `download` reuses `resolveTarget`'s `file` instead of a
     second `getFile`; assert the round-trip count in its test so the reuse
     cannot silently regress.

5. **Rendering and docs**
   - **Red** — `formatFileDetail` on a shortcut prints a target line; on a
     non-shortcut prints no such line.
   - **Green** — extend `file-format.ts`.
   - **Docs** — `docs/commands.md`: the file object gains `target_id` /
     `target_type`, `--type` lists `shortcut`, and a *Shortcuts* section
     reproduces 0025's role table with a worked example of the `rm` case.
     `README.md` highlights gain a shortcuts bullet. Cross-link 0025 from
     `decisions/0008` addressing.

## Acceptance criteria

- [ ] `gdrive ls "Reports/link-to-2026"` lists the target folder's children
- [ ] `gdrive docs read "Reports/link-to-doc"` reads the target document
- [ ] `gdrive rm "Reports/link-to-doc"` trashes the shortcut, and the target is
      untouched
- [ ] `gdrive info "Reports/link-to-doc"` reports `type: shortcut` with
      `target_id` and `target_type`, in both text and JSON
- [ ] `gdrive mv "Reports/link" "Other"` moves the shortcut into `Other`, and
      `gdrive mv a "Other/link-to-folder"` moves `a` into the target folder
- [ ] A dangling shortcut fails `NOT_FOUND` with a message naming it a shortcut
- [ ] `ls --type shortcut` filters to shortcuts
- [ ] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check` pass
- [ ] `docs/commands.md` and `README.md` updated; 0008 cross-links 0025

## Verification

- `bun run test src/lib/resolve-path.test.ts` — the walk and `resolveTarget`
- `bun run test src/lib/api.test.ts` — normalization and the type filter
- `bun run test src/commands` — the role table per command
- Manual, against a real account: create a shortcut to a folder and to a Doc in
  the Drive UI, then run the six acceptance-criteria commands above. The
  round-trip claims in 0025 §4 are only checkable here and in the `download`
  test.
