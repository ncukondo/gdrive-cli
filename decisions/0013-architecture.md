# 0013: Architecture & module map

Date: 2026-07-24
Status: accepted

## Context

File scopes are declared per task, but a fresh session needs one coherent map
of the source tree and the contract by which command modules attach to the CLI.
This consolidates that map (source of truth remains the individual decisions).

## Decision

### Source tree

```
src/
├── index.ts                 # entry: commander program, global options, top-level error handler   [0001]
├── commands/
│   ├── index.ts             # registerCommands(program): calls each area registrar                 [0001]
│   ├── auth.ts              # gdrive auth login|status|logout                                       [0004]
│   ├── account.ts          # gdrive account list|use|alias|remove                                   [0005]
│   ├── init.ts             # gdrive init                                                            [0011]
│   ├── upgrade.ts          # gdrive upgrade                                                          [0012]
│   ├── ls.ts search.ts info.ts download.ts       # Drive read                                       [0007]
│   ├── upload.ts mkdir.ts mv.ts cp.ts rm.ts      # Drive write                                      [0008]
│   ├── docs/   index.ts read.ts create.ts append.ts replace.ts insert.ts   # registerDocs           [0009]
│   ├── sheets/ index.ts tabs.ts read.ts write.ts append.ts clear.ts create.ts  # registerSheets     [0010]
│   └── share/  index.ts list.ts add.ts remove.ts link.ts                   # registerShare           [0014]
├── lib/
│   ├── output.ts            # text/json/quiet renderers + error envelope                            [0002]
│   ├── input.ts             # literal / @file / '-' (stdin) content+value reader                    [0002]
│   ├── fs.ts                # FsAdapter interface + node:fs impl (see 0012)                          [0002]
│   ├── config.ts           # TOML config load/discover/write, alias↔email                           [0003]
│   ├── auth.ts             # OAuth loopback flow, per-email token storage, refresh                   [0004]
│   ├── account.ts          # resolve account → OAuth2 client                                         [0004]
│   ├── api.ts              # Drive v3 wrapper (+ permissions methods)                                [0006, 0014]
│   ├── resolve-path.ts     # ID-or-path resolution                                                   [0006]
│   ├── docs-api.ts         # Docs v1 wrapper + Docs→markdown/text renderer                           [0009]
│   └── sheets-api.ts       # Sheets v4 wrapper + CSV/JSON/table codecs                               [0010]
│   └── upgrade.ts          # self-update env + logic                                                 [0012]
└── types/
    └── index.ts            # ErrorCode, result/envelope types, domain types (File, Permission, …)   [0002]
tests/
├── helpers/                # shared fakes (fs, Drive/Docs/Sheets clients, OAuth) — see 0012
├── integration/
└── e2e/
```

### Command registration contract

- Each command area exposes a **registrar** that mutates the commander program:
  flat areas export `registerAuth(program)`, `registerDriveRead(program)`,
  `registerDriveWrite(program)`, `registerAccount(program)`, `registerInit`,
  `registerUpgrade`; grouped areas export `registerDocs` / `registerSheets` /
  `registerShare` from their `index.ts`.
- `src/commands/index.ts` exports `registerCommands(program)` which calls every
  area registrar. **This file is a shared integration point:** each command
  task appends one import + one call here. That is an accepted, minimal
  coordination cost (append-only, trivially mergeable across worktrees) — it is
  the *only* sanctioned shared edit outside a task's own scope.
- A command handler validates args (zod), calls `lib/*`, and emits via
  `lib/output.ts`. Handlers never build JSON by hand and never call
  `process.exit` directly — they throw `AppError { code }`; `index.ts` maps
  code → exit code and format (0007).

### Naming: flat files vs. subdirectories

Top-level Drive verbs (`ls`, `mv`, …) are flat files. Multi-verb sub-namespaces
(`docs`, `sheets`, `share`) are directories with an `index.ts` registrar. This
matches the CLI surface (`gdrive docs read` → `commands/docs/read.ts`).

## Consequences

- A fresh session can create the full tree from this map; per-task scopes stay
  the authoritative owner list.
- The shared `commands/index.ts` and `tests/helpers/` are explicitly called out
  so parallel worktrees coordinate rather than collide silently.
