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
| [0014](0014-pre-1.0-compatibility.md) | Pre-1.0: breaking input/output changes allowed until 1.0 or a first user |
| [0015](0015-no-type-assertions.md) | No type assertions: parse at the edges, adapt generated clients |
| [0016](0016-shared-drive-scope.md) | Shared drives: IDs work everywhere, `search` scope is opt-in |
| [0017](0017-permission-denied-error-code.md) | 403 → `PERMISSION_DENIED` (exit 1), except a genuine scope failure |
| [0018](0018-shared-drive-roles.md) | `share add` grants `organizer` / `fileOrganizer` (revises 0011) |
| [0019](0019-shared-drive-paths.md) | `drive:<name>/<path>` reaches a shared drive by path (revises 0016 §3) |
| [0020](0020-drive-root-name.md) | `info` on a drive root reports the drive's real name |
| [0021](0021-markdown-writes.md) | Markdown is the format on both sides of `docs`; writes default to it (extends 0009) |
| [0022](0022-insert-at-marker.md) | `insert --before` / `--after <marker>` positions by text (extends 0009) |
| [0023](0023-list-numbering-and-links.md) | Ordered lists keep their numbering; autolinks and bare URLs link (extends 0021) |
| [0024](0024-soft-line-breaks.md) | A soft line break round-trips as a `\` hard break (extends 0021) |
| [0025](0025-shortcuts.md) | Shortcuts follow by argument role: containers and content yes, entries never (extends 0008) |
| [0026](0026-ln.md) | `gdrive ln <target> <folder>` creates a shortcut (extends 0025) |
| [0027](0027-forms-document.md) | A form is one YAML document; `forms read` / `forms responses` |
| [0028](0028-forms-write.md) | `forms write` applies a form document by item id (extends 0027) |
| [0029](0029-slides-document.md) | A deck is one YAML document of placeholders; `slides read` |
| [0030](0030-slides-write.md) | `slides write` applies a deck document by object id (extends 0029) |

## Related projects (reference implementations)

Required reading for the tasks that say "adapt from …". The **GitHub repos are
the canonical source** — a fresh PC won't have the local `../` checkouts, so
clone them when the local paths are absent:

```sh
git clone https://github.com/ncukondo/gcal-cli      # → ../gcal-cli
git clone https://github.com/ncukondo/yaml-form-cli # → ../yaml-form-cli
```

The decisions here fully specify behavior, so the siblings are an accelerator,
not a hard dependency.

- [`gcal-cli`](https://github.com/ncukondo/gcal-cli) (local: `../gcal-cli` if
  present) — sibling Google Calendar CLI; gdrive-cli mirrors its tech stack,
  output conventions, and auth UX. Adapt `src/lib/{output,config,auth,api}.ts`
  and its `tsconfig.json` / `vitest.config.ts`.
- [`yaml-form-cli`](https://github.com/ncukondo/yaml-form-cli) (local:
  `../yaml-form-cli` if present) — source of the development *process*
  (decisions + tasks + TDD + worktree) and the distribution model; adapt
  `src/upgrade.ts`, `install.sh`, `install.ps1`.
