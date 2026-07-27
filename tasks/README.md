# Tasks

One file per unit of work, created from [`_template.md`](_template.md).
Completed task files move to [`archive/`](archive/) (keep the filename).

Rules (see [`decisions/0001`](../decisions/0001-development-process.md)):

- Work **TDD-first**: the task file lists the failing tests to write before
  implementation. A task is done when its acceptance criteria are checked and
  `bun run test` / `bun run typecheck` pass.
- Each task declares `Depends on` and `Parallel`. Parallel-safe tasks have
  disjoint file scopes and can run in separate `git worktree`s.
- Don't restate decisions — link to `decisions/NNNN-*.md`. If work needs a
  decision change, record a new decision first.
- Docs (`docs/`, `README.md`) updates implied by a task are part of its DoD.

Before starting, read `decisions/0013-architecture.md` (source-tree map +
command-registration contract) and `decisions/0012-testing-strategy.md`
(fs/client injection + E2E policy). Rows below are grouped by parallel group,
**not strict task number** — always start from the top row and honor
`Depends on`. Sibling reference repos live at `../gcal-cli` and
`../yaml-form-cli` (see `decisions/README.md`).

## Current plan

| Task | Depends on | Parallel group | Status |
| ---- | ---------- | -------------- | ------ |
| [0001 Project setup & tooling](archive/0001-project-setup.md) | — | — | done |
| [0002 Output & error core](archive/0002-output-and-errors.md) | 0001 | A | done |
| [0003 Config (TOML) & discovery](archive/0003-config.md) | 0001 | A | done |
| [0004 OAuth + multi-account auth](archive/0004-auth-multi-account.md) | 0002, 0003 | — | done |
| [0005 Account commands](archive/0005-account-commands.md) | 0004 | — | done |
| [0006 Drive API wrapper & path resolution](archive/0006-drive-api.md) | 0004 | — | done |
| [0007 Drive read commands (ls/search/info/download)](archive/0007-drive-read.md) | 0006 | B | done |
| [0008 Drive write commands (upload/mkdir/mv/cp/rm)](archive/0008-drive-write.md) | 0006 | B | done |
| [0009 Docs commands](archive/0009-docs.md) | 0006 | C | done |
| [0010 Sheets commands](archive/0010-sheets.md) | 0006 | C | done |
| [0014 Share/permissions commands](archive/0014-share.md) | 0006 | C | done |
| [0011 `init` command](archive/0011-init.md) | 0003, 0004 | — | done |
| [0012 Distribution, installer & `upgrade`](archive/0012-distribution.md) | 0007, 0008, 0009, 0010, 0014 | — | done |
| [0013 README & user docs](archive/0013-docs-site.md) | 0012 | — | done |
| [0016 Remove type assertions](archive/0016-remove-type-assertions.md) | — | — | done |
| [0015 Upgrade googleapis (130 → 173)](archive/0015-googleapis-upgrade.md) | 0016 | — | done |
| [0017 Shared drive support](archive/0017-shared-drive-support.md) | — | — | done |
| [0018 Shared-drive review fixes](archive/0018-shared-drive-review-fixes.md) | 0017 | — | done |
| [0019 `PERMISSION_DENIED` for a role-denied 403](archive/0019-permission-denied-error-code.md) | — | — | done |
| [0020 `share add` grants the shared-drive roles](archive/0020-shared-drive-roles.md) | — | — | done |
| [0021 `drive:<name>/<path>` addressing](archive/0021-shared-drive-paths.md) | — | — | done |
| [0022 `info` names a shared drive root](archive/0022-drive-root-name.md) | — | — | done |
| [0023 `docs` writes take Markdown by default](archive/0023-markdown-writes.md) | — | — | done |
| [0024 `insert --before` / `--after <marker>`](archive/0024-insert-at-marker.md) | 0023 | — | done |
| [0025 List numbering & links](0025-list-numbering-and-links.md) | 0023 | — | todo |
| [0026 Soft line breaks](0026-soft-line-breaks.md) | 0025 | — | todo |

## Parallelism notes

- **Group A** (0002 / 0003): disjoint scopes — `lib/output.ts` + `types/` vs
  `lib/config.ts`. Run in parallel worktrees after 0001 lands.
- **Group B** (0007 / 0008): Drive read vs write commands; share `lib/api.ts`
  as a *dependency* (0006) but own different `commands/*.ts` files.
- **Group C** (0009 / 0010 / 0014): Docs vs Sheets vs Share — disjoint command
  trees (`commands/docs/*` vs `commands/sheets/*` vs `commands/share/*`). 0009
  and 0010 add their own `lib/*-api.ts`; 0014 extends `lib/api.ts` (0006) with
  permission methods, so it merges after 0006 and coordinates with 0007/0008 on
  `lib/api.ts` edits.

After v0.1.0 shipped, the plan continues with maintenance work. 0016 removed
the type assertions that would let a googleapis bump break silently, so it ran
before 0015 (decision 0015). 0017 fixed shared-drive access (issue #1) under
decision 0016, and 0018 closed the gaps its review found. 0019 then split a
role-denied 403 out of `AUTH_REQUIRED` (issue #3, decision 0017) — a
consequence of 0016 §1, since shared-drive requests only started reaching
Drive's permission checks once `supportsAllDrives` was set.
0020 widened `share add` to the shared-drive roles (issue #4, decision 0018,
which revises 0011), 0021 added `drive:<name>/<path>` addressing (issue #5,
decision 0019, which supersedes 0016 §3), and 0022 made `info` report a drive
root's real name (issue #6, decision 0020). That closes the shared-drive
follow-ups opened after v0.4.0.

0023 and 0024 both come from issue #7 and both extend 0009. 0023 is **done**:
Markdown is now the format on the write side too — a Markdown table arrives as
a Docs table instead of a line of pipes — and the write default flipped to match
`read` (decision 0021; breaking, allowed by 0014). Its manual pass against a
real account is what found the index bugs a fake client cannot show, and 0021 §5
records the approach that failed.

0024 then moved marker-relative positioning out of the `replace` workaround and
into `insert --before/--after` (decision 0022), reusing 0023's marker search so
the two commands cannot disagree on what "found" means. That closes issue #7.

0025 and 0026 are the follow-ups v0.6.0 left: transcribing a real document
found that a numbered document is silently renumbered and that `<https://…>`
stays literal (issue #8, decision 0023), and measuring that turned up a second,
independent bug — `read` emits a raw `U+000B` where the document has a line
break inside a paragraph (issue #9, decision 0024). Both decisions are written
from measurements against Drive's native `text/markdown` import and the Docs
API, which is what 0021 §4 asks for; the numbers are reachable through the API
even though `startNumber` is read-only, and 0023 §2 records the three-step
sequence that gets there. The two tasks run in order because they change the
same parser and the same round-trip test.

Order of first delivery to a usable CLI: 0001 → 0002/0003 → 0004 → 0006 →
0007 (list/read is the first useful surface), then fan out group B (0008) and
group C (0009 / 0010 / 0014). Finish with 0005 / 0011 (account/init), then
0012 (distribution) and 0013 (docs).

### Shared integration points (coordinate across worktrees)

- `src/commands/index.ts` — every command task appends one import + one
  `registerXxx(program)` call (append-only; see `decisions/0013`).
- `tests/helpers/` — shared fakes (fs, Drive/Docs/Sheets clients, OAuth). The
  first task needing a fake creates it here; later tasks import it
  (`decisions/0012`).
- `src/lib/api.ts` — created by 0006, extended by 0014 (permission methods) and
  used by 0007/0008. Coordinate edits; keep additions method-scoped.
