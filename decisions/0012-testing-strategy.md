# 0012: Testing strategy

Date: 2026-07-24
Status: accepted

## Context

Every task is TDD-first (0001) and several build "fake" Google clients and
inject the filesystem, in parallel worktrees. Without a shared convention the
fakes and injection styles diverge. This ports gcal-cli's testing approach.

## Decision

### Test types & locations

| Type | Location | What it covers | External deps |
|------|----------|----------------|---------------|
| Unit | `src/**/*.test.ts` (alongside source) | One module in isolation | All mocked; **no network, no real fs** |
| Integration | `tests/integration/**/*.test.ts` | Module interactions (config→output, arg→handler) | Fixtures; no network |
| E2E | `tests/e2e/**/*.test.ts` | Full CLI against real Google APIs | Requires real OAuth; **local only** |

CI runs `test:unit` + `test:integration`. E2E runs locally before commit.

### Dependency injection (the shared convention)

- **Filesystem** is injected via an adapter interface, not imported directly in
  testable code. Reuse gcal-cli's `AuthFsAdapter` shape
  (`existsSync/readFileSync/writeFileSync/mkdirSync/unlinkSync/chmodSync`) as
  the canonical `FsAdapter` in `lib/`. Production wires `node:fs`; tests pass an
  in-memory fake. Applies to `lib/auth.ts`, `lib/config.ts`, `lib/input.ts`.
- **Google clients** (Drive v3, Docs v1, Sheets v4, OAuth2) are injected into
  the `lib/*-api.ts` wrappers as constructor/factory arguments. Unit tests pass
  a hand-written fake exposing only the methods used (e.g. `files.list`,
  `documents.batchUpdate`, `spreadsheets.values.append`). The fake's shape is
  the minimal googleapis surface each wrapper calls — keep fakes in a shared
  `tests/` helper per API so parallel tasks agree on it.
- **OAuth loopback / browser / userinfo** in `lib/auth.ts` are injected
  (open-URL fn, token exchange, userinfo fetch) so the flow is unit-testable
  without a real browser.
- **stdin** is injected/param-passed for `lib/input.ts` so `-` is testable.

### E2E policy (CRITICAL)

When E2E fails: do **not** add mocks to bypass it, change expected values to
match broken behavior, or skip/delete the test. Investigate the root cause and
fix the implementation. E2E failures reveal issues unit tests miss.

## Consequences

- Task TDD plans that say "inject fs" / "fake Drive client" mean these shapes.
- A `tests/helpers/` (or per-area helper) holds the shared fakes; the first
  task to need each fake creates it there, later tasks import it.
