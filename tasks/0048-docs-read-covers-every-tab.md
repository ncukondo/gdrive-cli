# Task 0048: A read covers every tab, and a write names the one it means

Status: todo (move to `tasks/archive/` when done)
Depends on: 0047 — it needs that task's tab tree, its coordinate resolver, and
`docs tabs add`, which is what builds this task's live fixtures.
Parallel: no — same files as 0047, in sequence.

## Goal

`gdrive docs read` returns every tab of a document, each behind a marker naming
the tab it came from. `append`, `insert` and `replace` take `--tab`, and on a
document with more than one tab they refuse rather than pick.

## Context

- Decision: [`0058`](../decisions/0058-a-tab-is-a-coordinate.md) §2–§4. §1, §5
  and §6 landed in task 0047.
- **Why the read default changes at all.** Measured on 2026-08-08: a four-tab
  document read back as its first tab, with nothing in either output format
  saying the other three existed. A tab is easy to miss in the editor and
  impossible to notice from this CLI, and a caller that cannot tell a partial
  read from a whole one has no way to ask.
- `download --export-as md` has been returning every tab all along, under a
  heading per tab. So the CLI already contradicted itself about how much of a
  document it reads, depending on which verb you used.
- **Do not copy the export's marker.** It spells a tab as a top-level heading,
  which puts the tab's name at the same level as the headings inside it; in the
  measured output `# Tab 1` and the body's own `# First tab heading` were
  indistinguishable. 0058 §3 asks for a marker with no heading level to collide
  with.
- The marker anchors on the **tab id**, not the title, because a title is
  arbitrary text that can contain whatever would otherwise terminate the marker.
  Put the id first so a parser has something to anchor on when the title is
  hostile. Emit `depth` even when it is `0` — the API itself omits
  `nestingLevel` for a root tab, and that trap should not be re-staged in our own
  output.
- The refusal in §4 is [`0052`](../decisions/0052-rename.md)'s reasoning about
  `mv`: where a target is ambiguous the answer is a new argument, never a rule
  for picking. Writing to the first tab by default would make `read` and `write`
  disagree about what "the document" means, and would put the guess where its
  consequence is a modified file rather than an error message.

## Scope

- `src/lib/docs-api.ts` — rendering across a tab tree.
- `src/commands/docs/{read,append,insert,replace}.ts` and their tests.
- `tests/helpers/fake-docs.ts` — created by 0047; extended here.
- `tests/e2e/docs.test.ts`, `docs/commands.md`, `README.md` if it shows a
  `docs read` output.

## Out of scope

- **A `docs write` that applies a whole tab tree back.** Will not be done.
  [`0058`](../decisions/0058-a-tab-is-a-coordinate.md) §2 settles it: a tab is a
  stream, so the positional verbs gain a coordinate rather than being replaced by
  the whole-document projection a form or a deck gets. The marker `read` emits is
  informational, not an input syntax, and the tests should pin that it is not
  accepted back — an input syntax nobody documented is the thing that later
  becomes one by accident.
- **Headers, footers and footnotes.** Still
  [#21](https://github.com/ncukondo/gdrive-cli/issues/21).
- **Changing `download --export-as md`.** Drive renders that, not us.

## TDD plan

1. **`read` covers the tree**
   - **Red** — a document with three root tabs and one nested under the third
     returns all four, in document order, depth-first, each preceded by its
     marker.
   - **Red** — a **single-tab** document also emits a marker. One output shape,
     so a consumer never branches. This case is the one most likely to be argued
     away as noise; it is the reason the format is worth anything to a script.
   - **Red** — `--as text` emits the same markers. The reason for them does not
     depend on the render format, and text is already lossy
     ([`0036`](../decisions/0036-machine-format-by-default.md)).
   - **Red** — a title containing `-->` (or whatever the marker's terminator
     turns out to be) does not let the tab's content escape its marker. Pick the
     spelling that makes this case pass rather than the one that looks nicest.
   - **Green** — implement.
2. **`--tab` narrows a read**
   - **Red** — `read --tab <coord>` returns exactly that tab. **Not** its
     descendants: clicking a tab in the editor shows one tab, and that is the
     behavior to match.
   - **Red** — the marker is still emitted, for the same one-shape reason.
   - **Green** — implement.
3. **A write names its tab or is refused**
   - **Red** — on a multi-tab document, `append`, `insert` and `replace` (both
     `--as` modes) without `--tab` fail `INVALID_ARGS`, list the tabs with their
     ids, and **send no request at all**. Assert the second half; a refusal that
     has already written something is not a refusal.
   - **Red** — with `--tab`, exactly that tab changes and every sibling and the
     nested tab are byte-identical afterwards.
   - **Red** — on a single-tab document, all four commands work with no `--tab`,
     exactly as they did before.
   - **Green** — implement.
4. **Refactor** — `read` now walks a tree while the write paths resolve a single
   coordinate. If those two want different helpers, let them; do not force one
   abstraction over both.

## Acceptance criteria

- [ ] `docs read` returns every tab, depth-first, each behind a marker carrying
      its id and depth
- [ ] A single-tab document emits the marker too
- [ ] `read --tab` returns one tab and not its children
- [ ] `append` / `insert` / `replace` refuse on a multi-tab document without
      `--tab`, and write nothing when they refuse
- [ ] With `--tab`, no other tab is modified
- [ ] A single-tab document's behavior is unchanged for every command
- [ ] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check` pass
- [ ] `docs/commands.md` describes the marker and the refusal; `README.md` matches
      if it shows a `docs read`

## Verification

Two lists, kept apart so that "the automated one passed" cannot stand in for the
part it never ran (`decisions/0043` §4).

- Automated: `bun run test src/commands/docs src/lib/docs-api.test.ts`.
  `bun run test:e2e tests/e2e/docs.test.ts` — build a four-tab document with
  `docs tabs add` (0047), read it back and assert all four tabs arrive with their
  real ids; then `insert --tab` into the nested one and assert the other three are
  unchanged. The ids are the part a fake cannot supply honestly, since it invents
  them.
- Manual, against a real account: read a document whose tabs a person actually
  authored — not one this suite built — and check the concatenation reads in the
  order the tab strip shows, including nesting. Then pipe `docs read` into
  something that splits on the marker and confirm the pieces reassemble; the
  marker exists for that consumer and nothing automated plays that role. Finally,
  confirm in the browser that a `--tab` write left the other tabs' **formatting**
  alone, not just their text — the round trip is what task 0030's live pass
  caught and no assertion here covers style.
