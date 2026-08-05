# Task 0041: The rules that can be checked become scripts, and two hooks run them

Status: todo
Depends on: —
Parallel: yes — alongside 0042, which owns the prose half of the same decision.
Their file scopes are disjoint: this task writes `scripts/`, `.husky/` and
`.claude/`; 0042 writes `CLAUDE.md` files and touches no script.

## Goal

Six process rules that today exist only as sentences are checked by a script
that a hook runs. A commit that violates one fails; an agent that is about to
violate one is stopped before the edit. Nothing about the rules themselves
changes — only what happens when they are broken.

## Context

- [`decisions/0047`](../decisions/0047-rules-are-executed.md) — why a checkable
  rule stops being prose, which hook binds whom, and why the bypass belongs to a
  person and never to an agent. §1 and §2 are this task's whole brief.
- The rules being executed, each stated in its own record:
  [`0032`](../decisions/0032-decisions-are-append-only.md) §3 (a committed
  decision is not edited), §4 (a new decision gets an index row and a `Status`
  line naming its relationship), §5 (a task is archived when its code lands);
  [`0033`](../decisions/0033-implementation-lands-through-review.md) §1 (what
  lands through a pull request and what goes straight to main);
  [`0044`](../decisions/0044-the-reviewer-gets-the-current-plan.md) §1 (rebase
  before requesting review); [`0001`](../decisions/0001-development-process.md)
  (`git add -A` is never how a commit is staged);
  [`0036`](../decisions/0036-machine-format-by-default.md) §3 (no renderer
  computes a display width).
- **`scripts/changelog.ts` is the shape to copy.** It exports pure functions and
  keeps the filesystem, `process.argv` and the exit code inside
  `if (import.meta.main)`. That is what makes `scripts/changelog.test.ts`
  hermetic, and it is what lets one module serve both a git hook and a Claude
  Code hook here.
- `scripts/lint-casts.ts` is the precedent for a guard CI runs, and the
  counter-example for structure: its body runs at import time, so it cannot be
  imported or tested. This task fixes that in passing, because it needs the
  comment/string stripper that file already has.
- `bun run lint:casts` currently exits 0, and no `padEnd`, `padStart`,
  `stringWidth` or `eastasianwidth` appears in non-test `src/` or `scripts/`.
  Both new guards therefore start green; neither is a cleanup task in disguise.

## Scope

- `scripts/lib/ts-source.ts` (new) + its test — the comment/string stripper
  moved out of `lint-casts.ts` so a second scanner can share it.
- `scripts/lint-casts.ts` — body wrapped in `import.meta.main`, stripper
  imported rather than defined. No change to what it reports.
- `scripts/lint-widths.ts` (new) + test — 0036 §3.
- `scripts/lint-records.ts` (new) + test — 0032 §3, §4, §5.
- `scripts/lint-landing.ts` (new) + test — 0033 §1 and 0047 §5.
- `scripts/guard-bash.ts` (new) + test — 0001's staging rule and 0044 §1.
- `.husky/pre-commit`, `.husky/pre-push`.
- `.claude/settings.json` (new), `.claude/hooks/guard-record-edit.ts` (new),
  `.claude/hooks/guard-bash.ts` (new) — thin shims that read the hook payload on
  stdin and call the exported functions above.
- `package.json` — the new `lint:*` script entries.
- `.github/workflows/ci.yml` — `lint:widths` only (see below).
- `vitest.config.ts` — include `.claude/**/*.test.ts` only if a shim turns out
  to need its own test; the intent is that it does not.

## Out of scope

- **Everything `CLAUDE.md`.** Task 0042 owns the directory files and the removal
  of the root document's copied blocks.
- **Running `lint:records` and `lint:landing` in CI.** Both read the staged diff
  and the current branch, neither of which exists in a CI checkout in the form
  they need. `lint:widths` scans the tree and does run there. This is not a
  deferral to revisit: the two are pre-commit checks by construction, and 0047 §2
  already accepts that `--no-verify` reaches past them.
- **Enforcing where the root `CLAUDE.md` lands.** 0047 §5 names `.husky/`,
  `.claude/`, `scripts/` and a directory `CLAUDE.md`; it does not name the root
  file, and pull request #16 put it through review without a rule saying to.
  `lint-landing` therefore says nothing about it. Writing a rule the decision did
  not make is the failure this task is built to prevent. Not filed as an issue
  ([`0042`](../decisions/0042-deferred-work-is-an-issue.md) §2) — if it matters it
  is a decision, not a defect.
- **Checking that a deferral names an issue** (0042 §2). "Nobody wants it yet" and
  "see #12" are both compliant and no regex separates them from a description
  that names neither. It stays prose, and 0042 puts it where it is read.
- **Branch protection on main.** 0047's `Out of scope`, unchanged.

## TDD plan

Each script is a module of pure functions plus an `import.meta.main` shell. The
tests call the functions with literal inputs — a staged file list, a branch name,
a `tasks/README.md` fragment — so no test touches git, and the git plumbing lives
in the six lines the tests do not cover.

1. **Red — `scripts/lib/ts-source.ts`.** Move `stripNoise` out of
   `lint-casts.ts` and export it. Test: a `padEnd` inside a line comment, a block
   comment, a single-quoted string and a template literal all strip; code
   survives. `bun run lint:casts` still exits 0 and still reports the same shape
   on a file that has an assertion.

2. **Red — `scripts/lint-widths.ts`.** Export
   `findWidthCalls(files: {path, source}[]): Finding[]`, flagging `padEnd`,
   `padStart`, `stringWidth` and `eastasianwidth`. Tests: each identifier is
   found with its line number; the same word in a comment or a string is not;
   a `.test.ts` path is never scanned. Green: the CLI shell walks `src/` and
   `scripts/`, skips `*.test.ts`, and exits 1 with a message naming 0036 §3 and
   what to do instead (pipe through a formatter).

3. **Red — `scripts/lint-records.ts`.** Three exported checks over a staged file
   list of `{status, path}`:
   - `checkDecisionEdits` — a `M` on `decisions/NNNN-*.md` is a finding; `A` is
     not; `decisions/README.md` is exempt in both directions (0032 §4 requires it
     to be edited). Error text quotes 0032 §3 and says the fix is a new number,
     naming `revises` / `extends`.
   - `checkIndexRow(added, readme)` — every added decision needs a row in
     `decisions/README.md` linking its exact filename. Missing row is a finding
     that quotes 0032's "the index becomes load-bearing".
   - `checkStatusLine(path, source)` — an added decision's `Status:` line is
     `accepted`, optionally followed by `— revises`/`— extends` and at least one
     `[NNNN](NNNN-….md)` link. A `superseded by` status is a finding, because
     0032 §3 removed it.
   - `checkArchivedTasks(readme)` — a row in `tasks/README.md`'s plan table whose
     status is neither `todo` nor `in-progress` must link into `archive/`. This
     is the exact 0032 §5 failure: the status flips and the file does not move.
     Hermetic, because the link and the status are on the same line.

4. **Red — `scripts/lint-landing.ts`.** Export
   `checkLanding(branch, paths): Finding[]`.
   - On `main`, a staged path under `src/`, `tests/`, `docs/`, `scripts/`,
     `.github/`, `.husky/`, `.claude/`, or equal to `package.json`, `bun.lock`,
     `install.sh`, `install.ps1`, or a `CLAUDE.md` below the root, is a finding
     naming the `task/00NN-slug` branch it belongs on.
   - On a `task/*` branch, a staged path under `decisions/` or `tasks/` is a
     finding quoting 0044 §1 — this is the phantom that cost #16 a round.
   - **`decisions/CLAUDE.md` and `tasks/CLAUDE.md` are the exception to both
     rules, in opposite directions.** They sit under a records directory but are
     not records: 0047 §5 lands a directory `CLAUDE.md` through review, and 0032
     §6 has always classed a `CLAUDE.md` as description rather than a dated
     record. So they are blocked on `main` with the implementation paths, and
     allowed on a `task/*` branch. Read naively the two rules deadlock — neither
     branch could ever commit the file — which is why this is a test case and not
     a footnote.
   - On any other branch name, no finding. The rule is about main and task
     branches; inventing a third policy is out of scope.

5. **Red — `scripts/guard-bash.ts`.** Export
   `checkBashCommand(command, state): Block | null`.
   - `git add -A`, `git add .`, `git add --all` → blocked, quoting 0001. Tests
     cover the flag spellings, `git add ./src`, a path literally named `-A`
     after `--`, and `git add src/index.ts` passing.
   - `gh pr create` / `gh pr ready` with `state.rebased === false` → blocked,
     quoting 0044 §1 and printing the command to run
     (`git rebase main && git push --force-with-lease`). The shim computes
     `rebased` from `git merge-base --is-ancestor main HEAD`; the function takes
     it as an argument so the test needs no repository.

6. **Green — the hooks.** `.husky/pre-commit` gains `lint:casts`, `lint:widths`,
   `lint:records`, `lint:landing`. `.husky/pre-push` keeps `test:e2e` and, when
   it fails, prints 0012's CRITICAL paragraph — do not mock around it, do not
   adjust the expectation, do not skip the test — because that is the one moment
   anybody reads it. `.claude/settings.json` registers two `PreToolUse` hooks and
   the shims exit 2 with the message on stderr, which is what blocks the call.

7. **Refactor** — one error-formatting helper if the five scripts have grown five
   copies of it. Keep every message a sentence about what would go wrong, in the
   register `changelog.ts` uses; a bare rule number is not a message.

## Acceptance criteria

- [ ] Committing a modification to a committed `decisions/NNNN-*.md` fails, and
      `decisions/README.md` still commits freely
- [ ] Committing a new decision without its index row fails, naming the row to add
- [ ] A `tasks/README.md` row flipped to `done` while its link still points
      outside `archive/` fails the commit
- [ ] Committing `src/**` on `main` fails and names the branch to use; committing
      `tasks/**` on a `task/*` branch fails and cites 0044 §1
- [ ] `decisions/CLAUDE.md` commits on a `task/*` branch and fails on `main` —
      the opposite of `decisions/0047-*.md`, which does the reverse
- [ ] `git add -A` through the Bash tool is blocked before it runs
- [ ] `gh pr create` is blocked when main has moved past the branch, and passes
      after `git rebase main`
- [ ] A new `padEnd` in `src/` fails `bun run lint:widths`, and the same word in
      a comment does not
- [ ] `bun run lint:casts` reports exactly what it reported before the refactor
- [ ] A failing `bun run test:e2e` prints 0012's CRITICAL paragraph
- [ ] `bun run test` and `bun run typecheck` pass
- [ ] Every new script is reachable as a `package.json` entry and documented by
      its own header comment, naming the decision it enforces

## Verification

Two lists, kept apart so that "the automated one passed" cannot stand in for the
part it never ran ([`decisions/0043`](../decisions/0043-e2e-runs-before-push.md) §4).

- **Automated**: `bun run test scripts` — every check function against literal
  inputs, including the near-misses (`git add ./src`, a `padEnd` in a comment,
  `decisions/README.md`, a `todo` row outside `archive/`). `bun run test:e2e` —
  nothing; this task touches no Google API.
- **Manual, against a real repository**: the wiring, which no unit test reaches.
  1. A real `git commit` that violates each of the four `pre-commit` rules, and
     one that violates none, to confirm the hook runs and the message is legible.
  2. `git commit --no-verify` past the decision guard, confirming 0047 §2's
     bypass exists for a person.
  3. Both `PreToolUse` hooks firing in a live Claude Code session: an `Edit` on a
     committed decision, and `git add -A` through Bash. Neither is reachable from
     a test, because the hook only exists inside the harness.
  4. **`pre-commit` wall-clock time, before and after**, recorded in the outcome
     notes. 0047's Consequences commit to measuring and then cutting what hurts;
     without a number that sentence is the checklist this task exists to replace.
