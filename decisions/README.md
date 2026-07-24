# Decisions

Records of design and process decisions for **gdrive-cli**, one file per
decision, numbered in the order they were made. These are the source of truth
for *why* things are the way they are; the user-facing *what* lives in
[`docs/`](../docs/) and the code.

Format per file: `Date`, `Status` (accepted / superseded by NNNN), `Context`,
`Decision`, `Consequences`. Keep records short; link to them from task files
instead of restating them.

## Index

| # | Decision |
| - | -------- |
| [0001](0001-development-process.md) | Development process: decisions/tasks dirs, TDD, parallel worktrees |
| [0002](0002-tech-stack.md) | Tech stack & tooling (Bun, TS, commander, googleapis, TOML, vitest) |
| [0003](0003-distribution.md) | Distribution: npm package + single-file executable with `upgrade` |
| [0004](0004-multi-account.md) | Multi-account model: email-identified accounts + optional aliases |
| [0005](0005-auth-and-scopes.md) | OAuth flow, per-account token storage, and requested scopes |
| [0006](0006-configuration.md) | `config.toml` format and resolution order |
| [0007](0007-output-and-errors.md) | Output modes (text/json/quiet), exit codes, error codes |
| [0008](0008-drive-commands.md) | File addressing (ID + path) and Drive file commands |
| [0009](0009-docs-commands.md) | Google Docs read / edit commands |
| [0010](0010-sheets-commands.md) | Google Sheets read / edit commands |
| [0011](0011-sharing-commands.md) | Sharing & permissions (`share list/add/remove/link`) |
| [0012](0012-testing-strategy.md) | Testing: types, fs/client injection, E2E policy |
| [0013](0013-architecture.md) | Source-tree map & command-registration contract |

## Related projects (reference implementations)

Both live **on disk as siblings of this repo** and are required reading for the
tasks that say "adapt from …". If a checkout lacks them, clone from the URLs;
the decisions here fully specify behavior, so the siblings are an accelerator,
not a hard dependency.

- [`gcal-cli`](https://github.com/ncukondo/gcal-cli) — at `../gcal-cli`. Sibling
  Google Calendar CLI; gdrive-cli mirrors its tech stack, output conventions,
  and auth UX. Adapt `src/lib/{output,config,auth,api}.ts` and its
  `tsconfig.json` / `vitest.config.ts`.
- [`yaml-form-cli`](https://github.com/ncukondo/yaml-form-cli) — at
  `../yaml-form-cli`. Source of the development *process* (decisions + tasks +
  TDD + worktree) and the distribution model; adapt `src/upgrade.ts`,
  `install.sh`, `install.ps1`.
