# Task 0052: The e2e exclusion stops depending on the shell

Status: todo
Depends on: —
Parallel: yes (worktree-safe) — beside 0049, 0050 and 0051. It owns
`package.json`'s `scripts`, `vitest.config.ts` and `.husky/pre-commit`; the
other three touch none of them. It does not change `package.json`'s `version`
or its dependency lists, so a merge with any of them is textual.

## Goal

`bun run test` excludes the live suite on every platform, not only where the
shell strips POSIX single quotes (issue #18).

## Context

- Relevant decisions: [`0043`](../decisions/0043-e2e-runs-before-push.md) §1
  (only `pre-push` runs the live suite), [`0012`](../decisions/0012-testing-strategy.md)
  (why a unit run must never reach a real account),
  [`0047`](../decisions/0047-rules-are-executed.md) §1 (a rule a script can
  decide is a script).
- `package.json` passes `--exclude 'tests/e2e/**'`. Single quotes are POSIX
  quoting; `cmd.exe` does not treat them as quoting at all, so vitest can be
  handed the literal `'tests/e2e/**'`, which matches nothing.
- **The issue's "why it does not bite yet" has expired.** It was written when
  `tests/e2e/` was empty. Task 0039 filled it and task 0045 added the write
  paths; there are seven live test files there now. A contributor whose
  exclusion silently fails today runs the live suite from `bun run test`.
- The issue asks whether a config-level exclude can still be overridden by
  `test:e2e`'s path filter. **Measured: it cannot.** With
  `exclude: [..., "tests/e2e/**"]` in the config, `vitest run tests/e2e`
  collects nothing, and a CLI `--exclude` does not replace the config's list.
  So the config cannot be one file with an override; `test:e2e` needs its own.
- Also measured: a second config whose `include` is `tests/e2e/**/*.test.ts`
  collects exactly the seven files and nothing else.
- The issue's other open question — whether Bun's built-in shell normalises the
  quoting before `cmd.exe` sees it — **does not need answering**. The fix
  removes the quoted argument, so the answer changes nothing. Say that in the
  pull request rather than leaving it as a thing somebody should still check.

## Scope

- `vitest.config.ts`
- `vitest.e2e.config.ts` (new)
- `package.json` — the `scripts` block only
- `.husky/pre-commit` — the same quoted argument, now redundant

## Out of scope

- Making anything else in the repo Windows-safe. `install.ps1` installs a
  compiled binary and never runs these scripts; nothing else was surveyed.
  **This work will not be done** as part of this task, and no issue is opened —
  there is no report of a second failure.
- Running CI on `windows-latest`. That is a cost decision about the project's
  supported platforms, not a bug fix, and it is not requested.

## TDD plan

The unit of behaviour here is which files a command collects, and the thing that
can be wrong is a config, so the test drives the configs rather than the
scripts — a test that asserted `package.json` contains a string would be
asserting what the program is made of ([`tests/CLAUDE.md`](../tests/CLAUDE.md)).

1. **Red** — `vitest.config.test.ts` beside the configs: importing both configs
   and resolving their `include`/`exclude` against the repository's real test
   file paths, the default config must match **no** path under `tests/e2e/`, and
   the e2e config must match **only** paths under `tests/e2e/`. Against today's
   `vitest.config.ts` — which excludes nothing — the first half fails.
2. **Green** — add `exclude: [...configDefaults.exclude, "tests/e2e/**"]` to
   `vitest.config.ts` (spread the defaults; assigning the key replaces
   `node_modules` and `dist` otherwise), and add `vitest.e2e.config.ts` with
   `include: ["tests/e2e/**/*.test.ts"]`.
3. **Green** — `"test": "vitest run"`, `"test:watch": "vitest"`,
   `"test:e2e": "vitest run --config vitest.e2e.config.ts"`. No quotes, no glob
   characters, no leading environment assignment: nothing left for a shell to
   disagree about.
4. **Refactor** — drop `--exclude 'tests/e2e/**'` from `.husky/pre-commit`; the
   config now says it. Confirm `test:unit` (`vitest run src scripts`) and
   `test:integration` still collect what they did — both are positional filters
   over the default config and neither names `tests/e2e`.

## Acceptance criteria

- [ ] `bun run test` runs the unit and integration suites and collects no file
      under `tests/e2e/`
- [ ] `bun run test:e2e` collects exactly the files under `tests/e2e/` (and
      skips them with `GDRIVE_CLI_E2E_FOLDER` unset, as before)
- [ ] No script in `package.json` contains a quote or a glob character
- [ ] `.husky/pre-commit` and `.husky/pre-push` behave as they did
- [ ] `bun run test` and `bun run typecheck` pass
- [ ] `README.md`'s Development section still describes the commands correctly

## Verification

- Automated: `bun run test vitest.config.test.ts` — the two collections.
  `bun run test` and `bun run test:e2e`, both run and their file lists compared
  against `ls tests/e2e/*.test.ts`. `bun run test:e2e` — the suite itself is
  unchanged and must still skip cleanly with the environment variable unset.
- Manual, against a real account: none needed for the exclusion. On a machine
  with `GDRIVE_CLI_E2E_FOLDER` set, one `git push` to confirm `pre-push` still
  runs the live suite through the renamed script — that is the path a mistake
  here would break silently.
- Not verified, and stated as such in the pull request: nobody on this project
  has a Windows machine. What the change guarantees is that no shell is asked to
  quote anything, which is a stronger claim than "it was tested on cmd.exe" and
  is the reason the fix takes this shape rather than a different quoting.
