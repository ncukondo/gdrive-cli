# 0015: No type assertions — parse at the edges, adapt generated clients

Date: 2026-07-24
Status: accepted

## Context

The codebase carries ~85 `as` assertions across `src/` and `tests/`. They fall
into five recognizable groups, and every one of them is a place where the
compiler was told to stop checking:

1. **Closed string sets** — `VALID_TYPES.includes(value as FileType)` followed
   by `return value as FileType` (`ls`, `download`, `docs read`, `sheets
   read/write`, `share add`, `normalizePermission`). The `includes` call proves
   nothing to the compiler, so the narrowing is done twice by hand.
2. **Untrusted external data** — `parseToml(...) as Record<string, unknown>`,
   `JSON.parse(...) as TokenData`, `fetchJson(...) as ReleaseInfo`,
   `parsed as unknown[][]`, `res.data as DriveFileRaw`. These are the real
   danger: a shape we never checked, treated as checked.
3. **Generated googleapis clients** — `google.drive({...}) as unknown as
   DriveClient` at six sites. `as unknown as` is a total escape hatch, and
   `tasks/0015-googleapis-upgrade.md` calls out the consequence: *"The compiler
   will not catch a regression here … A renamed parameter, a changed response
   envelope, or a moved `data` field type-checks and passes the whole suite
   while failing at runtime."*
4. **Errors** — `(err as Error).message`, `(error as { code: unknown }).code`,
   after an `instanceof`/`in` check that already narrows in modern TS.
5. **Index access under `noUncheckedIndexedAccess`** — `accounts[0] as string`,
   `outcomes["dryRun"] as UpgradeOutcome`, `store[p] as string`. The flag was
   turned on deliberately (0002) and then asserted away.

`zod` is already a dependency (0002) but is used at exactly one site
(`src/index.ts` format validation). Decision 0014 makes churn cheap pre-1.0,
and task 0015 explicitly defers this work to "a separate task with a decision
record … worth doing soon rather than later".

## Decision

**No type assertions in `src/**` or `tests/**`.** That covers `as T`,
`as unknown as T`, `as any`, `<T>expr`, and non-null `!`. `as const` and
`satisfies` stay — they constrain rather than override inference.

Each group above gets one replacement pattern:

### 1. Closed string sets → `parseChoice`

`src/lib/args.ts` exposes:

```ts
export function parseChoice<T extends string>(
  values: readonly T[], value: string, flag: string,
): T   // values.find((v) => v === value) — returns T | undefined, no assertion
```

The `find` result *is* `T | undefined`; a miss throws `INVALID_ARGS` with the
existing message shape (`Invalid --type "x". Use: a, b, c.`). Option parsers
become one-liners over the same `VALID_*` arrays.

### 2. Untrusted external data → zod at the boundary

Config TOML, stored tokens, the GitHub release JSON, and `--values` JSON are
parsed with a zod schema and `safeParse`. A failure maps to the *same*
`AppError` code and message the hand-rolled check produced (`CONFIG_ERROR`,
`INVALID_ARGS`, `API_ERROR`), so behavior is unchanged. Schemas live next to
the type they validate; `z.infer` supplies the type where one is needed.

Stored token files are the one behavior change: a corrupt
`accounts/<email>.json` used to flow through as a well-typed lie, and now
raises `AUTH_REQUIRED` ("re-run `gdrive auth`"), which is what the user has to
do anyway.

### 3. Generated clients → an adapter module, not a cast

The hand-written port interfaces (`DriveClient`, `DocsClient`, `SheetsClient`)
stay exactly as they are — 0012's injection model and the `tests/helpers/`
fakes are untouched. What changes is how *production* builds one:
`src/lib/google-clients.ts` exposes `toDriveClient(drive_v3.Drive)`,
`toDocsClient(docs_v1.Docs)`, `toSheetsClient(sheets_v4.Sheets)`, each a plain
delegating object literal. The generated types are checked against our ports at
that single file, and nowhere else in the codebase imports `drive_v3` & co.

Two port tweaks fall out of actually type-checking against googleapis 130:

- `files.get`/`files.export` take `responseType?: "arraybuffer"` rather than
  `responseType?: string`, matching gaxios' literal union.
- `files.get` splits into `get` (metadata → `DriveFileRaw`) and `getMedia`
  (`alt: "media"` → `unknown`), which is what removes the
  `res.data as DriveFileRaw` assertion at its root instead of validating a
  payload we already asked Drive to shape with `fields`.

This is the piece task 0015 wanted: a googleapis bump that moves a parameter or
a response envelope now fails `bun run typecheck` instead of failing live.

### 4/5. Errors and index access → checks, not assertions

`instanceof Error` and `"code" in error` already narrow; the assertions come
off. `errorToCode` matches against an `ErrorCode[]` with `find`. Index access
is destructured (`const [first] = accounts`) or explicitly checked; fixture
objects use `satisfies Record<string, UpgradeOutcome>` so dot access keeps its
type.

Tests get two small helpers rather than assertions: `firstCall(fn)` (throws if
the mock was never called, returns the typed argument tuple) and an
`ExitSignal`-throwing `process.exit` mock — a mock that throws is genuinely
`never`-returning, so no `undefined as never` is needed.

### Enforcement

`oxlint` has no rule for this today, so the guard is a `bun run lint:casts`
script (a grep over `src/` and `tests/`) wired into CI next to `typecheck`.
Any assertion that must survive needs an inline comment giving the reason; the
script's allowlist is that comment marker (`// assertion:`). At the time of
writing the allowlist is empty.

## Consequences

- googleapis drift becomes a compile error at one file — the main open risk in
  task 0015 shrinks to runtime/OAuth behavior.
- `zod` moves from one site to every external boundary; schemas are the source
  of truth for config, token, and release shapes.
- Fakes and `decisions/0012`'s injection model are unchanged; production wiring
  gains one adapter call per client.
- New code must reach for `parseChoice`, a zod schema, or a narrowing check.
  Anything that still "needs" an assertion is a signal the port type is wrong.
