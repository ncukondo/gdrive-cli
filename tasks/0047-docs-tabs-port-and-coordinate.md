# Task 0047: The Docs port learns about tabs, and `docs tabs` manages them

Status: todo (move to `tasks/archive/` when done)
Depends on: —
Parallel: no — it changes the signature of nearly everything in
`src/lib/docs-api.ts`, so nothing else should be editing `src/commands/docs/` at
the same time.

## Goal

Every Docs request this CLI builds names the tab it acts on, so
`docs replace --as text` can no longer edit tabs the CLI cannot show. `gdrive
docs tabs` lists a document's tab tree and creates, deletes, renames and
reorders a tab.

Content commands keep reading and writing the **first** tab in this task — but
by naming it, not by omitting the field. Task 0048 is what widens them.

## Context

- Decision: [`0058`](../decisions/0058-a-tab-is-a-coordinate.md). §1, §5 and §6
  are this task; §2–§4 are 0048's.
- The defect this closes was measured on 2026-08-08 against a real four-tab
  document, and it is worth restating because it decides the whole shape:
  **Docs v1's default for an omitted tab differs by request type.** An omitted
  `tabId` on a `Location` or `Range` means the first tab; an omitted
  `tabsCriteria` on `replaceAllText` means *every* tab. `src/lib/docs-api.ts`
  omits both, so `docs replace` is scoped one way in its Markdown mode and the
  other way under `--as text`. The measured run reported *Replaced 3
  occurrences* and had rewritten two sibling tabs and one nested tab, none of
  which `docs read` can display.
- `includeTabsContent=true` **replaces** the legacy fields rather than adding to
  them: `body` comes back absent. That is why this is one task and not five —
  every function in `docs-api.ts` that reads `document.body` changes at once.
- [`0046`](../decisions/0046-replace-as-text-keeps-its-reach.md) chose to keep
  `replaceAllText` for `--as text` precisely *because* its reach is wider than
  `findMarkerRanges`'. That reasoning is untouched here: within a tab the reach
  is the same as before, headers and footers included. Only the tab dimension is
  bounded. Do not "fix" this by routing `--as text` through the Markdown path —
  0046 enumerates why that is worse, and issue
  [#21](https://github.com/ncukondo/gdrive-cli/issues/21) is where that work
  lives.
- Tab ids are `t.`-prefixed (`t.0` for the first tab, `t.<random>` after). A tab
  *titled* `t.something` would therefore be unaddressable, which is
  [`0055`](../decisions/0055-a-name-has-to-be-addressable.md)'s class in a new
  place — `src/lib/names.ts` already holds the shape of that refusal.
- `TabProperties.nestingLevel` is output-only and comes back **absent** for a
  root tab, not `0`. Measured. Anything that reads it needs `?? 0`.

## Scope

- `src/lib/docs-api.ts` — the port, the request types, the tab tree, the
  coordinate resolver.
- `src/commands/docs/tabs.ts` (new) and `src/commands/docs/index.ts` (one
  append-only registration).
- `src/commands/docs/{read,append,insert,replace,create}.ts` — mechanical only:
  they pass the first tab's id where they used to pass nothing.
- `src/lib/names.ts` — the `t.`-shaped-title refusal.
- `tests/helpers/fake-docs.ts` — **new, and check this before planning around
  it**: there is no shared Docs fake today. Four files each build their own
  inline (`src/lib/docs-api.test.ts`, `tests/integration/default-format.test.ts`,
  `shortcut-roles.test.ts`, `failed-create.test.ts`), and all four have to grow a
  tab tree at once. [`0012`](../decisions/0012-testing-strategy.md) says the
  first task needing a shared fake creates it in `tests/helpers/`; this is that
  task.
- `tests/e2e/docs.test.ts`, `docs/commands.md`.

## Out of scope

- **Reading or writing content in a non-first tab.** That is task 0048, and the
  split is deliberate: this task removes the ability to damage an unseen tab,
  which is worth landing before the larger behavior change.
- **Headers, footers and footnotes.** Still
  [#21](https://github.com/ncukondo/gdrive-cli/issues/21). Naming a tab on every
  request does not make any request reach a segment it does not reach today.
- **`TabProperties.iconEmoji`.** Will not be done —
  [`0058`](../decisions/0058-a-tab-is-a-coordinate.md)'s `Out of scope` disowns
  it.
- **Making `download --export-as md` agree with `docs read`.** The export is
  Drive's rendering, not ours, and this task does not change what `read` covers.

## TDD plan

1. **A fake that can hold two tabs**
   - There is no red step here and that is the point: **every case below is
     unfalsifiable against a single-tab fixture**, because "the first tab" and
     "every tab" are the same document. Build the multi-tab fake first, then
     write step 3's cases and watch them fail for the right reason.
2. **The port's unit of work is a tab**
   - **Red** — `docs read` on a document whose *first* tab is empty and whose
     second holds text still returns the first tab's content. Assert through the
     command, not by naming a function ([`0037`](../decisions/0037-tests-assert-behaviour.md));
     the point is that the mechanical change did not silently widen anything.
   - **Green** — `getDocument` sends `includeTabsContent: true`; `renderDocument`,
     `endOfBody`, `findMarkerRanges`, `paragraphBoundary` and `tableAt` take a
     tab instead of a document. `insertMarkdown`'s re-read after `insertTable`
     re-reads the same tab.
3. **A request cannot omit its tab**
   - **Red** — `docs replace --find X --replace Y --as text` on a three-tab
     document where every tab contains `X` changes **only the first tab**, and
     the request carries an explicit `tabsCriteria`. This is the case the whole
     task exists for.
   - **Red** — `append`, `insert` and `replace` in Markdown mode each send a
     `tabId` naming the first tab.
   - **Green** — then make omission impossible rather than merely absent: mark
     the tab field **required** in our own `DocsRange`, in `insertText`'s
     location and on `replaceAllText` in the `DocsRequest` union. `bun run
     typecheck` is then the check that no future request omits one, which is what
     [`0047`](../decisions/0047-rules-are-executed.md) §1 asks for and is
     stronger than a bespoke lint — it fails at the keystroke, in a command CI
     and `.husky/` already run.
4. **A coordinate resolves or is refused**
   - **Red** — `--tab t.0` resolves; a title unique in the document resolves; a
     title held by two tabs is `INVALID_ARGS` **listing every candidate with its
     id**; an unknown title is `NOT_FOUND`. A value starting `t.` is always read
     as an id, never as a title.
   - **Red** — a nested tab is addressable by its own title with no path
     syntax, and the refusal above is what covers the collision case.
   - **Green** — one resolver, used by every consumer.
5. **`docs tabs` lists the tree**
   - **Red** — id, title, index, depth and parent id for each tab, in document
     order, depth-first. Text format separates fields with a tab and indents
     nothing, so depth is a **column** ([`0036`](../decisions/0036-machine-format-by-default.md) §2–§3).
   - **Green** — implement.
6. **`docs tabs add | rm | rename | mv`**
   - **Red** — `add` with a parent and an index lands where asked; `rename`
     changes the title; `mv` changes parent and index; `rm` deletes.
   - **Red** — `rm` on a tab with children **says what it will remove before it
     removes it**, for [`0031`](../decisions/0031-recursive-copy.md) §3's reason.
     The API takes the descendants with it whether we mention them or not.
   - **Red** — `add --title "t.foo"` and `rename … "t.foo"` are refused. Reuse
     `src/lib/names.ts`; do not write a second copy of that rule.
   - **Green** — implement.
7. **Refactor** — the resolver and the tree walk will both want to exist in one
   place. If `docs-api.ts` is the wrong home for them by the end, say where they
   went and why in the report.

## Acceptance criteria

- [ ] `docs replace --as text` on a multi-tab document changes the first tab only
- [ ] No request type in `DocsRequest` can be constructed without naming a tab —
      omitting one is a `typecheck` failure, not a runtime surprise
- [ ] `docs tabs` lists the tree with ids, and `add`/`rm`/`rename`/`mv` work
- [ ] `rm` on a parent tab names the descendants it will take
- [ ] A title that resolves to two tabs is refused with both ids; a `t.`-shaped
      title cannot be assigned
- [ ] `docs read`, `append`, `insert` and `create` behave exactly as before on a
      single-tab document
- [ ] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check` pass
- [ ] `docs/commands.md` documents the new command and says which tab the content
      commands still act on

## Verification

Two lists, kept apart so that "the automated one passed" cannot stand in for the
part it never ran (`decisions/0043` §4).

- Automated: `bun run test src/lib/docs-api.test.ts src/commands/docs` — the port
  and the commands. `bun run test:e2e tests/e2e/docs.test.ts` — this task adds
  live cases, and one of them is the whole reason the suite exists here: build a
  three-tab document with `docs tabs add`, put the same marker in each tab, run
  `docs replace --as text`, and assert the two other tabs are **unchanged**. A
  fake cannot hold this honestly, because a fake's answer to an omitted
  `tabsCriteria` is whatever its author believed.
- Manual, against a real account: open the document the e2e run leaves behind
  when it fails, in the browser, and confirm the tab strip matches what
  `docs tabs` printed — order, nesting and titles. Nothing automated compares
  our tree to the one a person sees. Then, before this is called done, **break
  step 3's fix locally** — drop the `tabsCriteria` back out — and watch the e2e
  case go red. A live case nobody has seen fail is one nobody knows is wired up
  (task 0045's reasoning).
