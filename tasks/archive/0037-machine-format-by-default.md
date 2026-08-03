# Task 0037: The default is machine-readable, and no renderer measures anything

Status: done — PR [#15](https://github.com/ncukondo/gdrive-cli/pull/15), merged
2026-08-03, after four review rounds.
Depends on: 0034 — it derived `TYPE_W` from the vocabulary and added the docs
transcript test this task deletes. Supersedes task 0036, which is closed unstarted.
Parallel: no — it touches every renderer, `lib/output.ts` and `lib/config.ts`.

## Goal

`gdrive ls` prints JSON. `gdrive ls -f text` prints tab-separated fields. No
function in the codebase asks how wide a string draws.

## Context

- Decision: [`0036`](../decisions/0036-machine-format-by-default.md) is the
  specification. §1 is the default, §2 is the renderers, §3 is why no width
  function may come back.
- Task 0036 (`tasks/0036-renderer-properties.md`) and its pull request #14 are
  closed unmerged. Read #14's review before starting: it is where the claim that
  no correct width table exists was established, by measurement rather than by
  argument. Do not re-litigate it.
- **One thing to salvage from #14, and only one.** Its first commit deletes
  `tests/integration/docs-transcripts.test.ts`, which
  [`0035`](../decisions/0035-docs-are-downstream.md) §2 requires independently of
  anything here. Delete it in this task's first commit, alone.
- Also relevant: [`0007`](../decisions/0007-output-and-errors.md) (the envelope
  and `--quiet`, both unchanged), [`0006`](../decisions/0006-configuration.md)
  (`default_format` keeps moving the default per user),
  [`0014`](../decisions/0014-pre-1.0-compatibility.md) (this needs a `CHANGELOG.md`
  entry — the largest break the project has made).

## Scope

- `src/lib/config.ts` — `default_format` falls back to `json`, not `text`.
- `src/commands/file-format.ts` — `formatFileTable`, `formatFileDetail`.
- `src/commands/drives.ts`, `src/commands/share/list.ts`,
  `src/commands/sheets/tabs.ts`, `src/lib/sheets-api.ts` — the other four
  renderers.
- `tests/integration/docs-transcripts.test.ts` — deleted.
- `docs/commands.md`, `docs/configuration.md`, `README.md` — every transcript,
  and the sentence that says text is the default.
- `CHANGELOG.md` — an `## 0.8.0` entry already exists; this change belongs in it.

## Out of scope

- **Removing `-f text`** — [`0036`](../decisions/0036-machine-format-by-default.md)
  "Out of scope".
- **Changing the JSON envelope, the exit codes, or `--quiet`.** `--quiet` already
  emits bare ids and is the right answer for a caller who wants one field; it
  does not change.
- **The document commands.** `docs read` still emits Markdown and `forms read`
  still emits YAML; those already *are* the machine representation
  ([`0036`](../decisions/0036-machine-format-by-default.md) §1). Confirm rather
  than change them.

## TDD plan

1. **Delete the wrong guard**
   - Remove `tests/integration/docs-transcripts.test.ts`, alone, first commit.

2. **A text row round-trips**
   - **Red** — for each renderer, a row split on `\t` yields exactly the fields
     that went in, for a set of names that must include a full-width name, a
     name longer than any old column width, a name of exactly the old width, and
     an emoji. This is the property that replaces "the columns line up": it is
     something tab-separated output can actually promise, and it fails today
     because padding makes a field's boundary unrecoverable.
   - **Green** — join with `\t`, pad nothing, delete every `*_W` constant.
   - **Refactor** — if the five renderers now share a shape, share it. Do not
     introduce a helper that takes a width.

3. **A control character cannot forge a field**
   - **Red** — a name containing a tab or a newline does not produce extra
     fields or extra rows.
   - **Green** — replace control characters (and U+2028 / U+2029) with a space in
     text mode only. `-f json` carries the real name, and a test asserts the two
     disagree on such a name.

4. **The default flips**
   - **Red** — with no config and no `-f`, `ls` emits the JSON envelope; with
     `default_format = "text"` it emits text; `-f text` overrides a `json`
     config. `--quiet` is unaffected in both.
   - **Green** — `src/lib/config.ts`.

5. **A row does not depend on the other rows**
   - **Red** — for each renderer: render a list, then render the same list with
     one name made longer, and assert every *other* row is byte-identical. This
     is what [`0036`](../decisions/0036-machine-format-by-default.md) §2 buys,
     stated as behaviour — an aligned renderer fails it because widening one
     field repads every row, and it catches alignment however it is built
     ([`0037`](../decisions/0037-tests-assert-behaviour.md) §2). Do not write a
     test that scans `src/` for `padEnd`: that asserts spelling, not output, and
     `0037` §1 rules it out.

6. **Docs**
   - Every transcript in `docs/commands.md` re-rendered from the code, the
     default described correctly in `docs/configuration.md` and `README.md`, and
     the `CHANGELOG.md` 0.8.0 entry gaining this break at the top of its list.
     Do not add a test that pins any of them ([`0035`](../decisions/0035-docs-are-downstream.md) §2).

## Acceptance criteria

- [x] `gdrive ls` with no config and no flag emits `{"success":true,...}`
- [x] `gdrive ls -f text` emits tab-separated rows and pads nothing
- [x] A file named `研修医へのフィードバックシート` and one named `Budget` both
      round-trip through `split("\t")`
- [x] A name containing a newline produces one row in text and its real name in JSON
- [x] `default_format = "text"` still works; `--quiet` is unchanged
- [x] Making one name longer changes that row and no other, for every renderer
- [x] `bun run test:all`, `bun run typecheck`, `bun run lint`, `bun run format:check` pass
      (this criterion said `bun run test`, which is watch mode and cannot be met
      non-interactively; raised in four review rounds, corrected here on the way out)
- [x] `docs/`, `README.md` and `CHANGELOG.md` updated in the same pull request

## Outcome notes

Four review rounds. Every round found a real defect, and the two that mattered
most were the author diagnosing their own method rather than answering the list
they were handed.

- **Six instances of one defect shape**, across three rounds: code branching on
  the *resolved* format where it should branch on whether the caller **named**
  one. `--quiet` returned an envelope; `docs read` and `forms read` returned an
  envelope instead of their documents; and `gdrive auth` stopped prompting for
  OAuth credentials, so a fresh install could not authenticate. The first fix for
  `auth` then made it worse — exit 0 having done nothing — because it answered
  the finding rather than asking what a prompt needs. It needs a terminal. The
  class was finally closed by deriving the search over *sinks*: five
  `=== "json"|=== "text"` hits in `src/`, four behavioural, and the full
  `.option(` inventory showing no fourth kind of preference exists.
- **`decisions/0040` was written from this pull request**, because eleven `line`
  sites were named and eleven were converted, leaving `rm.ts` — the one command
  where a forged second line asserts a deletion. The census that closed it walked
  every `renderSuccess` call site and printed each `text:` and `quiet:`
  expression whatever form it took, which found eighteen more the grep could not
  see. A grep for the sink's *spelling* is not a search for the sink.
- **Six false claims in the changelog.** Five were traced to a decision's
  `Context` section, one of them written by the maintainer who had just written
  the rule forbidding that source. The sixth came from **symmetry** — `docs read`
  and `forms read` behave alike now, so a row was written for both without asking
  whether both had a past; `forms read` did not exist in v0.7.0. Twice more a
  sound mechanism sentence was followed by a tidier consequence than it supported
  ("every value text mode prints", "a confirmation exactly one"), the second
  contradicted by a transcript three hundred lines away in the same branch.
- **`decisions/0039` corrected two of the maintainer's own claims**, measured:
  U+4DC0 is where Annex #11, Bun and `string-width` *agree* (one column) — the
  real disagreement is U+1F7F0 — and row independence does not catch
  constant-width padding, so the field round trip is what guards
  [`0036`](../../decisions/0036-machine-format-by-default.md) §2.
- **What the change cost**, recorded because it is the one place a caller loses
  something they supplied: `init` and `download` now sanitise the caller's own
  `-o` path in text mode. `-f json` keeps it exact.
- **Deferred deliberately**: `runFlow` is a second wait-for-a-human that does not
  pass the `canPrompt` gate, so with `client_secret.json` present and no tty
  `gdrive auth` blocks on the loopback server. Identical on `main`, inherent to
  [`0005`](../../decisions/0005-auth-and-scopes.md) step 3, and its own task.

## Verification

- `bun run test src/commands` and `bun run test src/lib` — the round-trip
  properties and the default
- Manual, against a real account: `gdrive ls` on a folder holding a Japanese
  name, a 30-character ASCII name and a short one — as JSON, then `-f text`
  piped through `column -t -s $'\t'`. The first must parse; the second is what a
  person does when they want columns, and it is the check that the tabs are
  where they should be.
