# gdrive-cli

CLI for Google Drive, Docs, and Sheets — read and simple edits — with
multi-account switching. Sibling of `gcal-cli`, designed for AI-agent use.

## Getting Started

- Read `decisions/README.md` for the design (source of truth for *why*).
- Read `tasks/README.md` for the current plan; pick a task, follow its TDD plan.
- Architecture map: `decisions/0013`. Testing conventions: `decisions/0012`.
- User-facing behavior lives in `docs/` and `README.md`.

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

## Tech Stack (see `decisions/0002`)

Bun · TypeScript · commander · googleapis · smol-toml · zod · vitest · oxlint · oxfmt

## Commands

```bash
bun run dev            # run the CLI
bun run test           # unit + integration, once, then exits
bun run test:watch     # the same set, re-run on change
bun run test:unit      # unit tests under src/ and scripts/
bun run test:integration
bun run test:e2e       # requires auth; `test` and `test:watch` exclude it
bun run lint / format / format:check / typecheck
bun run changelog 0.8.0   # print one version's CHANGELOG.md section
```

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

`CHANGELOG.md` is also in `package.json`'s `files`, so it ships in the npm
tarball. `0014` does not require that — `--notes-file` discharges §2 — but its
Consequences make this file the compatibility *record*, and
[`0003`](decisions/0003-distribution.md) sends npm users to their package
manager rather than to a release page, so npm is the one channel whose users
never pass the record. Keep the entry; keep the links in it absolute.

Preview what the release will say with `bun run changelog <version>`.

## Development Rules (see `decisions/0001`, `0032`, `0033`)

- **No living SPEC**: the code is the source of truth for *what*. `decisions/`
  holds the *why* the code cannot show; `docs/` describes behavior for a user;
  `tasks/NNNN-*.md` decide what to build before the code exists (TDD
  Red→Green→Refactor). Where a document and the code disagree, the code wins.
- **Decisions are append-only** (`0032`): never edit a committed decision file —
  not even to add a dependency to a list. Write a new one and read the directory
  from the highest number down. `decisions/README.md` indexes the relationships.
- **Tasks expire** (`0032` §5): a merged task is archived in the next commit, not
  at the end of a batch. Correct it once on the way out if the implementation
  diverged; after that it is history.
- **TDD**: failing test first, minimal code to pass, refactor green.
- **Commits**: small; specific `git add <file>` (never `-A`/`.`); English.
- **Implementation lands via PR** (`0033`): `src/`, `tests/`, `docs/`,
  `package.json` go on a `task/00NN-slug` branch, reviewed by a fresh agent that
  holds no implementation context, then rebase-merged. `decisions/` and `tasks/`
  commit straight to main; a task's status/archive update follows the merge.
- **Parallel**: parallel-safe tasks use `git worktree`; deps declared per task.
- Docs updates are part of a task's Definition of Done, in the same PR.
