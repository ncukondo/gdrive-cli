# Task 0038: `bun run test` runs the suite once and exits

Status: in review — PR [#16](https://github.com/ncukondo/gdrive-cli/pull/16)
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

- [ ] `bun run test </dev/null` exits 0 without waiting for input
- [ ] `bun run test src/lib/output.test.ts` runs that file alone
- [ ] `bun run test:watch` enters watch mode
- [ ] No script and no workflow names `test:all`
- [ ] A file placed at `tests/e2e/x.test.ts` is not run by `bun run test`
- [ ] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run lint:casts`,
      `bun run format:check` pass
- [ ] No file under `tasks/` outside `archive/`, and no line in `CLAUDE.md`,
      names `bun run test` for something that is not a single run

## Verification

- `bun run test </dev/null` — the criterion that could not be met before.
- `grep -rn 'bun run test' tasks/ CLAUDE.md .github/` — the class, not the
  instances. Every hit outside `tasks/archive/` must be a single run.
- No manual pass against a real account: nothing here reaches Google.
