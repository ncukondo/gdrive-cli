# 0002: Tech stack & tooling

Date: 2026-07-24
Status: accepted

## Context

gdrive-cli is a sibling of [`gcal-cli`](https://github.com/ncukondo/gcal-cli):
both are Google API CLIs designed for both human and AI-agent use. Reusing
gcal-cli's stack lets us port its auth, config, and output patterns directly.

## Decision

Adopt gcal-cli's stack and tooling:

| Component | Choice |
|-----------|--------|
| Runtime | Bun |
| Language | TypeScript (ESM, `"type": "module"`) |
| CLI framework | `commander` |
| Google API client | `googleapis` (Drive v3, Docs v1, Sheets v4, OAuth2) |
| Config format | TOML via `smol-toml` |
| Input validation | `zod` |
| Test runner | `vitest` (unit `src/**/*.test.ts`, `tests/integration`, `tests/e2e`) |
| Lint | `oxlint` |
| Format | `oxfmt` |
| Git hooks | `husky` |

Binary name: **`gdrive`**. Package name: `@ncukondo/gdrive-cli`.

Code must stay runnable under plain Node (for `npx`) as well as Bun: no `Bun.*`
APIs in shipped code paths.

### Dependency versions (starting point, mirror gcal-cli)

`commander ^12`, `googleapis ^130` (or newer; needs Drive v3, Docs v1,
Sheets v4, OAuth2), `smol-toml ^1`, `zod ^4`. Dev: `typescript ^5`,
`vitest ^2`, `oxlint`/`oxfmt` latest, `husky ^9`, `@types/bun` latest.

### tsconfig / vitest (copy from gcal-cli at `../gcal-cli`)

Use gcal-cli's `tsconfig.json` verbatim: `target/module ESNext`,
`moduleResolution "bundler"`, `types ["bun-types"]`,
`allowImportingTsExtensions`, `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`,
`noEmit`, `outDir "dist"`. And its `vitest.config.ts`
(`globals: true`, `include: ["src/**/*.test.ts", "tests/**/*.test.ts"]`).

Full script list (superset of the summary above): add `test:all`
(`vitest run`), `prepare` (`husky || true`), and `prepublishOnly`
(`bun run build`) — the last is required by the distribution task (0012).

Scripts (mirror gcal-cli):

```
bun run dev            # bun run src/index.ts
bun run build          # bun build src/index.ts --outdir dist --target node
bun run build:bin      # bun build src/index.ts --compile --outfile gdrive
bun run test           # vitest
bun run test:unit      # vitest run src
bun run test:integration
bun run test:e2e       # requires auth
bun run lint / format / format:check / typecheck
```

## Consequences

- Command handlers, `lib/auth.ts`, `lib/config.ts`, and `lib/output.ts` can be
  adapted from gcal-cli rather than written from scratch.
- Tooling differs from yaml-form-cli (which uses `bun test` + `biome`); only
  its *process* (0001) and *distribution* (0003) are borrowed, not its
  toolchain.
