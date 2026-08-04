# Task 0038: `bun run test` runs the suite once and exits

Status: done — PR [#16](https://github.com/ncukondo/gdrive-cli/pull/16), merged
2026-08-04 after one review round.
Depends on: —
Parallel: no — it changes `package.json`, and every open task's acceptance
criteria name the script it changes.

## Goal

An implementer who runs the command their acceptance criteria name gets a pass
or a fail and their prompt back. Watch mode keeps its place under a name that
says so.

## Context

- `package.json`'s `test` is `vitest`, which starts watch mode. Measured with no
  terminal attached (`</dev/null`): the suite runs, 809 tests pass in 5.6s, and
  the process then sits at `Waiting for file changes...` indefinitely. It is the
  only one of the five test scripts that does not exit.
- Nothing executes it. CI runs `test:all`; `.husky/pre-commit` calls
  `bunx vitest --changed --run --exclude 'tests/e2e/**'` without going through a
  script. What names it is documentation: `tasks/_template.md`,
  `tasks/README.md`, `CLAUDE.md`, and the acceptance criteria of all five open
  tasks.
- So the first command an implementer runs to satisfy a criterion is one that
  never returns. `tasks/archive/0037-machine-format-by-default.md:111` records
  this being raised in four review rounds and corrected in that one file, which
  is [`0040`](../decisions/0040-a-review-finding-names-a-class.md) §1's failure
  mode: the instance was fixed and the class was left. This task is the class.
- `test:all` is `vitest run` with no filter, and `vitest.config.ts` includes
  `tests/**/*.test.ts`. The moment `tests/e2e/` holds a file, CI reaches for a
  real Google account and fails. `pre-commit` already guards against this with
  `--exclude 'tests/e2e/**'`; the scripts do not. Whether E2E is ever written is
  a separate question and is not decided here.
- No decision governs the names of npm scripts, and this task does not create
  one. [`0012`](../decisions/0012-testing-strategy.md) settles what the layers
  are, not what invokes them.

## Scope

- `package.json` — the `scripts` block only.
- `.github/workflows/ci.yml` and `.github/workflows/release.yml` — the line in
  each that names the script.
- `CLAUDE.md` — the Commands block.
- `README.md` — the Development block.

The last two of those are not in the list this task was written with. A
`grep -rn 'test:all'` after the first edit found `release.yml`, where the same
one-line change guards the release job, and `README.md:132`, which tells a
contributor to run a script that would no longer exist. Recorded here rather
than fixed quietly, per [`0040`](../decisions/0040-a-review-finding-names-a-class.md)
§1: the class was two sites wider than the plan, and the plan is where that has
to be visible before review, not after
([`0033`](../decisions/0033-implementation-lands-through-review.md) §2).
`decisions/0002` also names `test:all` in its script list and is left alone
([`0032`](../decisions/0032-decisions-are-append-only.md) §3).

Not `tasks/_template.md`, `tasks/README.md` or the five open task files. Their
`bun run test` lines become true the moment the script does what its name says,
which is the argument for changing the script rather than the sentences. They are
checked, not edited.

## Out of scope

- **Writing E2E tests, or removing E2E from `0012` and `0013`.** The exclusion
  added here keeps a future `tests/e2e/` from breaking CI on the day it appears.
  Deciding whether it should appear is its own task and its own decision.
- **Editing archived task files.** They say `bun run test` because that is what
  the script was called. They are history
  ([`0032`](../decisions/0032-decisions-are-append-only.md) §5).
- **Anything inside a test.** No test changes; 809 pass before and after.

## TDD plan

None. This renames scripts and changes no behaviour of the CLI, so there is no
failing test to write first ([`0001`](../decisions/0001-development-process.md)
asks for tests of what is built, and nothing is built here). The suite itself is
the check: it must report the same 52 files and 809 tests through the new script
names as through the old ones.

The four script forms, and what each must do:

| script | command | must |
| ------ | ------- | ---- |
| `test` | `vitest run --exclude 'tests/e2e/**'` | run once, exit 0, 52 files |
| `test` + a path | same, filter appended | run that file only |
| `test:watch` | `vitest --exclude 'tests/e2e/**'` | watch, as `test` did |
| `test:unit` / `test:integration` / `test:e2e` | unchanged | unchanged |

`test:all` is deleted. It becomes a second name for `test`, and two names for
one command is what invites the next reader to pick the wrong one.

## Acceptance criteria

- [x] `bun run test </dev/null` exits 0 without waiting for input
- [x] `bun run test src/lib/output.test.ts` runs that file alone
- [x] `bun run test:watch` enters watch mode
- [x] No script and no workflow names `test:all`
- [x] A file placed at `tests/e2e/x.test.ts` is not run by `bun run test`
- [x] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run lint:casts`,
      `bun run format:check` pass
- [x] No file under `tasks/` outside `archive/`, and no line in `CLAUDE.md`,
      names `bun run test` for something that is not a single run

## Outcome notes

One review round, and everything it found was about the process rather than the
five-file diff. That is the useful result: the change itself was mechanical, and
it was the first branch to run under
[`0041`](../../decisions/0041-the-task-is-current-during-review.md), so what got
tested was the rule.

- **The class was two sites wider than the plan.** A `grep -rn 'test:all'` after
  the first edit found `.github/workflows/release.yml`, where the same one-line
  change guards the release job, and `README.md:132`, which told a contributor to
  run a script that would no longer exist. Both went into `Scope` on main before
  review began, which is [`0041`](../../decisions/0041-the-task-is-current-during-review.md)
  §3's first application. The reviewer then closed the class independently rather
  than from that list: it extracted every `bun run <name>` in the repository and
  diffed the names against `package.json`, confirming all sixteen resolve, and
  ran the two other documented commands that could have rotted.
- **The reviewer was handed a stale plan anyway**, and this is the finding that
  outlives the task. GitHub stored the pull request's base at `b23c6d3`, so
  `gh pr diff 16` replayed the main-only `tasks/` commits as if the branch had
  made them, and served the task file in its pre-widening form: a `Scope` of
  three files against a branch touching five. Correcting the task on main cannot
  reach that copy. [`0044`](../../decisions/0044-the-reviewer-gets-the-current-plan.md)
  is the answer — rebase before requesting review, and read the plan by ref —
  and the rebase here emptied the phantom, verified with
  `gh pr diff 16 --name-only`.
- **The plan file failed this task's own last criterion.** `tasks/README.md`'s
  note for 0038 was written in the present tense ("`bun run test` is `vitest`,
  which watches and never exits"), so merging would have made the plan assert
  two false things. It is not reachable from a branch
  ([`0033`](../../decisions/0033-implementation-lands-through-review.md) §1), so
  it was corrected on main, and the general form is now a rule in that file:
  a note describing current behaviour is written in the past tense, because
  nothing in the merge routine revisits the prose.
- **`--exclude` appends, it does not replace.** The worry was that a CLI
  `--exclude` overrides vitest's defaults and re-exposes `node_modules`. The
  reviewer settled it by planting `src/node_modules/vendored.test.ts` and running
  the old and new forms: 52 files both times, neither collected it.
- **Not verified: Windows.** `--exclude 'tests/e2e/**'` is single-quoted, which
  `cmd.exe` does not treat as quoting, so a contributor running the scripts
  outside a POSIX shell may pass the glob through literally. Harmless while
  `tests/e2e/` is empty and not harmless after task 0039. Filed as issue
  [#18](https://github.com/ncukondo/gdrive-cli/issues/18)
  ([`0042`](../../decisions/0042-deferred-work-is-an-issue.md) §2).
- **One LOW, fixed on the branch**: `CLAUDE.md` described `test:unit` as "src
  unit tests" while it has run `scripts/changelog.test.ts` since task 0035.
  A comment change earns no second round
  ([`0033`](../../decisions/0033-implementation-lands-through-review.md) §4).

## Verification

- `bun run test </dev/null` — the criterion that could not be met before.
- `grep -rn 'bun run test' tasks/ CLAUDE.md .github/` — the class, not the
  instances. Every hit outside `tasks/archive/` must be a single run.
- No manual pass against a real account: nothing here reaches Google.
