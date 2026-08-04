# Task 0039: The first E2E suite, and the hook that runs it

Status: todo
Depends on: 0038 — until `test` stopped being an unfiltered `vitest run`, a file
under `tests/e2e/` broke CI and the release job.
Parallel: no — it creates `tests/e2e/` and `.husky/pre-push`, which nothing else
owns, but every later task's `Verification` section changes shape because of it.

## Goal

`git push` runs the CLI against a real Google account, inside one folder it
created, and refuses the push if Drive disagrees with what the fakes believe.
On a machine with no account, it says so and gets out of the way.

## Context

- Decision: [`0043`](../decisions/0043-e2e-runs-before-push.md) is the
  specification. §1 is the cadence, §2 the containment, §3 the skip, §4 what
  stays manual, §5 what E2E is not for.
- [`0012`](../decisions/0012-testing-strategy.md) is where the layer was defined
  and never built; its CRITICAL policy applies from the first green run. When
  E2E fails, the implementation is wrong until proven otherwise.
- What the fakes have been wrong about, which is what to cover first:
  `tasks/archive/0023-markdown-writes.md` (three write-side defects in index
  arithmetic, none reachable from a fake),
  `tasks/archive/0034-live-verification-fixes.md` (a form reading as
  `type: file`, and the `Link` nobody knew Drive returned for a shortcut).
- The tty-dependent paths are out of reach here by construction
  ([`0043`](../decisions/0043-e2e-runs-before-push.md) §4). Issue
  [#17](https://github.com/ncukondo/gdrive-cli/issues/17) is the one already
  known, and it stays manual.
- Read [`0012`](../decisions/0012-testing-strategy.md)'s injection conventions
  before writing a helper. E2E is the one layer that injects nothing.

## Scope

- `tests/e2e/helpers/sandbox.ts` — resolve the account and
  `GDRIVE_CLI_E2E_FOLDER`, create the run's subfolder, prune old ones, trash it
  on success, leave it on failure, and expose the skip predicate.
- `tests/e2e/drive.test.ts` — read and write against Drive.
- `tests/e2e/docs.test.ts` — the Markdown round trip.
- `tests/e2e/sheets.test.ts` — values in, values out.
- `.husky/pre-push` — new.
- `docs/configuration.md` — `GDRIVE_CLI_E2E_FOLDER` in the environment table.
- `README.md` — the Development block gains how to set the folder up.
- `CLAUDE.md` — the Commands block says what `pre-push` will do.

## Out of scope

- **Forms.** `forms read` deserves E2E and the fixture needs a form built through
  `forms.batchUpdate`, which is the machinery task 0030 builds anyway. It joins
  the suite there.
- **Shortcuts.** The two properties task 0034 paid for — a shortcut's `Link`
  pointing at itself, and `target_id` / `target_type` naming what it points at —
  need a shortcut in the sandbox, and the CLI cannot make one until task 0028
  adds `ln`. Building the fixture through raw `googleapis` instead would put a
  second, untested code path in the helper for one property, so it waits for
  0028, where it is one command. Both deferrals name a task rather than an issue,
  which [`0042`](../decisions/0042-deferred-work-is-an-issue.md) §2 asks for and
  a task satisfies more strongly than a tracker row.

  The consequence is worth stating plainly: the first E2E covers neither of the
  two defects that motivated it most directly. What it does cover is the write
  side, which is where all three of 0023's defects were and where a fake is
  least able to help.
- **Anything needing a tty or a browser.** [`0043`](../decisions/0043-e2e-runs-before-push.md)
  §4, issue [#17](https://github.com/ncukondo/gdrive-cli/issues/17).
- **Shared drives.** [`0043`](../decisions/0043-e2e-runs-before-push.md) §2.
- **Running E2E in GitHub Actions.** [`0043`](../decisions/0043-e2e-runs-before-push.md)
  "Out of scope", and nobody wants it yet.
- **Asserting how output is laid out.** That is a renderer property
  ([`0035`](../decisions/0035-docs-are-downstream.md) §1). E2E asserts what
  Google accepted and returned.

## TDD plan

Red-then-green does not fit a layer whose oracle is a live API: the first run is
discovery, not a failing assertion. What replaces it is that each test states the
property *before* it is run against Drive, and a disagreement is resolved by
[`0012`](../decisions/0012-testing-strategy.md)'s rule, not by editing the
expectation.

1. **The sandbox, and nothing else**
   - `sandbox.ts` creates `e2e-<utc timestamp>-<pid>` under
     `GDRIVE_CLI_E2E_FOLDER`, yields its id, trashes it in an `afterAll` that
     runs only when every test in the file passed.
   - On start, trash any sibling `e2e-*` older than 24 hours.
   - Export `describeLive`, which skips the whole file when the variable is
     unset or no account is authenticated — skipped, never failed
     ([`0043`](../decisions/0043-e2e-runs-before-push.md) §3).
   - **First property**: a test that only creates the sandbox leaves nothing
     behind. Run it twice; `ls` of the parent shows no `e2e-*` afterwards.
   - **Second property**: a deliberately failing test leaves exactly one
     subfolder behind, and the next run prunes nothing because it is fresh.

2. **Drive, read**
   - Seed the sandbox with a folder, a Doc, a Sheet, and an uploaded binary
     whose name is `研修医へのフィードバックシート`.
   - `ls` reports `folder`, `doc`, `sheet` and `file` for the four, and
     `--type doc` returns exactly the Doc. The vocabulary is the one in
     `docs/commands.md`'s file object and `lib/api.ts`'s map, not a paraphrase
     of it: `folder | doc | sheet | slides | form | shortcut | file`.
   - `info` on each carries a `web_view_link`, and `target_id` is `null` on
     everything that is not a shortcut.
   - `-f text` output for the four rows splits on `\t` back into the names that
     went in, including the Japanese one.

3. **Drive, write**
   - `mkdir`, `upload`, `cp`, `mv`, then `rm`, each inside the sandbox, each
     confirmed by a following `info` rather than by the command's own output.
   - `rm` puts the file in the trash and leaves the sandbox otherwise intact.

4. **Docs, the round trip**
   - Create a document from Markdown holding: a table, an ordered list starting
     at 3, `<https://example.com>`, a bare URL, a soft line break, and a nested
     list.
   - `docs read` returns Markdown that reproduces every one of those. This is
     where 0023, 0025 and 0026 all found what a fake could not, and where a
     regression is most likely.
   - `docs insert --before <marker>` puts text where the marker is, and the
     document still reads back correctly afterwards.

5. **Sheets, the round trip**
   - `sheets write` a range holding a formula, a number, a string that looks
     like a date, and an empty cell; `sheets read` returns what Sheets stores,
     and the test states which of those Sheets is expected to transform.
   - `sheets append` adds a row after the last, not after the requested range.

6. **The hook**
   - `.husky/pre-push` runs `bun run test:e2e`.
   - With no `GDRIVE_CLI_E2E_FOLDER`, a push is not blocked and prints why.
   - With a failing E2E test, the push is refused.

## Acceptance criteria

- [ ] `bun run test:e2e` with the variable unset reports skipped and exits 0
- [ ] `bun run test:e2e` with it set creates exactly one `e2e-*` folder, and it
      is gone when the run passes
- [ ] A failing run leaves its folder; the following run does not delete it
- [ ] No test addresses any path outside the run's own subfolder, shown by
      grepping the suite for the sandbox id being the root of every path built
- [ ] `git push` on a configured machine runs the suite; on an unconfigured one
      it does not block
- [ ] `ls --type doc` returns exactly the Doc, and the four seeded files report
      `folder`, `doc`, `sheet` and `file`
- [ ] The Markdown round trip covers a table, a list starting at 3, an autolink,
      a bare URL and a soft line break
- [ ] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run lint:casts`,
      `bun run format:check` pass
- [ ] `docs/configuration.md`, `README.md` and `CLAUDE.md` describe the variable
      and the hook

## Verification

- Automated: `bun run test:e2e` against a real account, twice, once with a test
  forced to fail.
- Manual, against a real account, in a terminal: open
  `GDRIVE_CLI_E2E_FOLDER` in a browser during a run and confirm nothing appears
  outside the run's subfolder, and that it disappears at the end. The containment
  invariant is the one thing that must not be taken on the suite's word.
- Manual, and separately from the above
  ([`0043`](../decisions/0043-e2e-runs-before-push.md) §4): none needed for this
  task's own behaviour. Nothing here prompts or opens a browser.
