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
