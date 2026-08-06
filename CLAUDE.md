# gdrive-cli

CLI for Google Workspace files — read and simple edits — with multi-account
switching. Sibling of `gcal-cli`, designed for AI-agent use. `package.json`'s
`description` and `README.md` say which file types, and `docs/commands.md` the
surface.

## Getting Started

- `decisions/` holds the design, one record per topic, and is the source of truth
  for *why*. Read it from the highest number down; `decisions/CLAUDE.md` has the
  conventions and how to navigate it.
- Read `tasks/README.md` for the current plan; pick a task, follow its TDD plan.
- Writing a test, wherever it lives: [`tests/CLAUDE.md`](tests/CLAUDE.md). A unit
  test sits beside its source, so that file does not load for most of them.
- User-facing behavior lives in `docs/` and `README.md`.
- **A directory's conventions live in its own `CLAUDE.md`** and load when you
  edit there ([`0047`](decisions/0047-rules-are-executed.md) §3). Look for one
  before you start. `decisions/0013` still holds the architecture map and
  `decisions/0012` the testing rationale; the directory files carry the part you
  need at the moment you type.

## Reference implementations

Two sibling repos are required reading for tasks that say "adapt from …". They
may or may not be checked out locally (they won't be on a fresh PC), so the
GitHub repos are the canonical source — clone them if the local paths are absent:

```sh
# canonical source (works on any machine)
git clone https://github.com/ncukondo/gcal-cli      # ../gcal-cli if not present
git clone https://github.com/ncukondo/yaml-form-cli # ../yaml-form-cli if not present
```

- **gcal-cli** (`https://github.com/ncukondo/gcal-cli`, local `../gcal-cli` if
  present) — tech stack, `tsconfig.json`/`vitest.config.ts`, and the patterns
  to adapt for `lib/{output,config,auth,api}.ts` (tasks 0002/0003/0004/0006).
  Its `spec/` mirrors what our `decisions/` cover.
- **yaml-form-cli** (`https://github.com/ncukondo/yaml-form-cli`, local
  `../yaml-form-cli` if present) — the dev *process* this repo follows, plus
  `src/upgrade.ts` + `install.sh`/`install.ps1` to adapt for task 0012.

Our `decisions/` fully specify behavior; the siblings are an accelerator, not a
hard dependency.

## Commands

`package.json`'s `scripts` is the list, and the only one — see
[`0047`](decisions/0047-rules-are-executed.md) §4 for why it is not copied here.
Day to day: `dev`, `test`, `test:watch`, `typecheck`. `changelog` takes a
version. `.github/workflows/ci.yml` holds the set CI runs, and `.husky/` the set
a commit and a push run.

`.husky/pre-push` runs `test:e2e` against a real account
([`0043`](decisions/0043-e2e-runs-before-push.md)). Set `GDRIVE_CLI_E2E_FOLDER`
to a Drive folder id and each test file works inside a throwaway subfolder of
it, kept when that file fails and deleted permanently when it passes; leave it
unset and the suite skips rather than fails, so a push is never blocked on a machine with no
credentials. What the suite cannot reach — a prompt, a
browser, how output looks at a real width — stays a manual pass, named
separately in each task's `Verification` section.

## Releasing

1. **Write the `CHANGELOG.md` section first**, newest at the top, under a
   heading of exactly `## <version> — <YYYY-MM-DD>`. List every breaking change
   with what a consumer must do about it: [`0014`](decisions/0014-pre-1.0-compatibility.md)
   permits breaking changes before 1.0 only if the release notes carry them, so
   this file is where that obligation is met. It is written for someone deciding
   whether to upgrade, not as a second copy of the git log.

   **Check every claim against the code, the diff, or a live run.** A decision's
   `Context` section is never a source: it is dated prose describing what its
   author believed before the code existed
   ([`0032`](decisions/0032-decisions-are-append-only.md) §2), and four false
   claims in 0.8.0's first draft came from one. Task 0035's pull request has the
   four.
2. Bump `package.json`'s version, then tag `v<version>`. Both stay outside a
   pull request ([`0033`](decisions/0033-implementation-lands-through-review.md)).
3. `.github/workflows/release.yml` runs `scripts/changelog.ts` before it builds
   anything, and passes the section to `gh release create --notes-file`;
   GitHub's generated commit list is appended below it. A tag whose version has
   no section fails the job before anything is published.

`CHANGELOG.md` ships in the npm tarball. `0014` does not require that — `--notes-file` discharges §2 — but its
Consequences make this file the compatibility *record*, and
[`0003`](decisions/0003-distribution.md) sends npm users to their package
manager rather than to a release page, so npm is the one channel whose users
never pass the record. Keep the entry; keep the links in it absolute.

## Development Rules (see `decisions/0001`, `0032`, `0033`, `0047`)

- **No living SPEC**: the code is the source of truth for *what*. `decisions/`
  holds the *why* the code cannot show; `docs/` describes behavior for a user;
  `tasks/NNNN-*.md` decide what to build before the code exists (TDD
  Red→Green→Refactor). Where a document and the code disagree, the code wins.
- **Tasks expire** (`0032` §5): a merged task is archived in the next commit, not
  at the end of a batch. Correct it once on the way out if the implementation
  diverged; after that it is history.
- **TDD**: failing test first, minimal code to pass, refactor green.
- **Commits**: small, in English, staging the paths you name.
- **Implementation lands through a pull request**, reviewed by a fresh agent that
  holds no implementation context, then rebase-merged; `decisions/` and `tasks/`
  commit straight to main and a task's status and archive update follow the
  merge. What counts as implementation is [`0033`](decisions/0033-implementation-lands-through-review.md)
  §1 as widened by [`0047`](decisions/0047-rules-are-executed.md) §5 — read it
  there rather than from a copy here. Rebase before requesting review
  ([`0044`](decisions/0044-the-reviewer-gets-the-current-plan.md) §1).
- **Parallel**: parallel-safe tasks use `git worktree`; deps declared per task.
- Docs updates are part of a task's Definition of Done, in the same PR.
- **A rule a script can decide is a script, not a sentence**
  ([`0047`](decisions/0047-rules-are-executed.md) §1). `.husky/` and
  `.github/workflows/ci.yml` are what runs on a commit and a push; read them to
  see what is checked rather than remembered. Anything not covered here is in
  `decisions/`, read from the highest number down.
