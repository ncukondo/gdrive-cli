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
| [0010 Sheets commands](0010-sheets.md) | 0006 | C | todo |
| [0014 Share/permissions commands](archive/0014-share.md) | 0006 | C | done |
| [0011 `init` command](0011-init.md) | 0003, 0004 | — | todo |
| [0012 Distribution, installer & `upgrade`](0012-distribution.md) | 0007, 0008, 0009, 0010, 0014 | — | todo |
| [0013 README & user docs](0013-docs-site.md) | 0012 | — | todo |

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
