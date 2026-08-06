# Task 0031: `gdrive slides read`

Status: todo (move to `tasks/archive/` when done)
Depends on: 0029 — reuses the `yaml` dependency that task adds, and follows the
document conventions it establishes. Not a code dependency beyond `package.json`.
Parallel: yes (worktree-safe) — a new `commands/slides/` tree and a new
`lib/slides-api.ts`, disjoint from the Forms and shortcut tasks.

## Goal

A deck reads as a YAML document of layouts, placeholder text and speaker notes,
with everything else listed read-only under `elements`.

## Context

- Decisions: [`0029`](../decisions/0029-slides-document.md) is the
  specification. [`0030`](../decisions/0030-slides-write.md) consumes the same
  schema; read it before fixing the schema's shape.
- No new OAuth scope: `presentations.get` accepts the `drive` scope
  [`0005`](../decisions/0005-auth-and-scopes.md) already requests.
- Prior art: task 0029's `lib/form-document.ts` is the same projection pattern —
  follow its file layout so the two are recognisably siblings.
- The API shapes that matter: `slideProperties.layoutObjectId` resolves to a
  Layout page whose `layoutProperties.name` is the predefined layout name;
  speaker notes are the `BODY` placeholder on `slideProperties.notesPage`,
  identified by `speakerNotesObjectId`; a placeholder is a `shape` with a
  `placeholder.type` (`TITLE`, `BODY`, `SUBTITLE`, `CENTERED_TITLE`, …).

## Scope

- `src/lib/slides-api.ts` — the client port (`presentations.get`) and its
  generated-param checks.
- `src/lib/slide-document.ts` — the projection and its zod schema, both
  directions in one file (0032 adds the reverse).
- `src/commands/slides/{index,read}.ts` + tests — new.
- `src/commands/index.ts` — one `registerSlides(program)` call (append-only).
- `tests/helpers/` — a Slides client fake.

## Out of scope

- `slides write` / `slides create` — task 0032.
- `--as markdown`, thumbnails, table contents, per-run styling — deferred in
  0029.

## TDD plan

1. **The projection** (`lib/slide-document.ts`)
   - **Red** — a presentation whose slides use `TITLE_AND_BODY`,
     `SECTION_HEADER` and `BLANK` projects to 0029 §2's document: `layout` by
     name, `title` / `body` / `subtitle` from the matching placeholders, `notes`
     from the notes page's `BODY` placeholder, `id` on every slide, `skipped`
     only when true. A slide on a custom layout reports the layout's object id
     instead of a name. A placeholder with no text is omitted, not emitted
     empty.
   - **Red (elements, 0029 §3)** — a dragged text box appears under `elements`
     with `kind: shape` and its text; an image appears with `kind: image` and no
     text; a table and a chart appear with their kinds. Nothing under `elements`
     carries a transform or a size.
   - **Green** — implement the projection and the zod schema.
   - **Refactor** — resolving a layout id to its name needs the presentation's
     `layouts`; keep that a lookup built once, not a scan per slide.

2. **The client port** (`lib/slides-api.ts`)
   - **Red** — `getPresentation` surfaces a 404 as `NOT_FOUND` and a 403 as
     `PERMISSION_DENIED`
     ([`0017`](../decisions/0017-permission-denied-error-code.md)).
   - **Green** — implement, params checked against `slides_v1`.

3. **`slides read`**
   - **Red** — text output is the YAML document and parses back to the same
     structure; `-f json` puts the structure in `data.presentation`, not a YAML
     string; quiet prints the presentation id; the `<file>` argument goes
     through the same path/id resolution as every other command; a deck of
     nothing but hand-placed shapes reads as `BLANK` slides full of `elements`
     rather than as empty slides.
   - **Green** — implement.

4. **Docs**
   - `docs/commands.md` gains a `slides` section: the document schema, the
     layout names, and `elements` documented as read-only *with the reason* —
     0030 §3 turns editing one into an error, and the docs are where a caller
     finds that out before hitting it.
   - `README.md` highlights gain a Slides bullet.

## Acceptance criteria

- [ ] `gdrive slides read "Decks/Q3" > deck.yaml` writes a document that
      round-trips through a YAML parser unchanged
- [ ] A template-built deck reads with `layout`, `title`, `body` and `notes`
      populated and no `elements`
- [ ] A deck built from dragged text boxes reads with its text under `elements`
- [ ] `-f json` carries the structure in `data.presentation`
- [ ] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check` pass
- [ ] `docs/commands.md` and `README.md` updated

## Verification

- `bun run test src/lib/slide-document.test.ts` — the projection, per layout and
  per element kind
- `bun run test src/commands/slides` — the command
- Manual, against a real account: one deck from a Slides template with speaker
  notes, one deck built by dragging text boxes onto blank slides. The second is
  the case a fake will not naturally produce and the one 0029 §3 exists for.
