# Task 0012: Distribution, installer & `upgrade`

Status: done
Depends on: 0007, 0008, 0009, 0010, 0014
Parallel: no

## Goal

Ship npm build, single-file binaries, installer scripts, and `gdrive upgrade`,
per `decisions/0003`.

## Context

- Relevant decisions: `decisions/0003-distribution.md`
- Adapt yaml-form-cli's `src/upgrade.ts`, `install.sh`, `install.ps1`
  (`../yaml-form-cli` or clone — see `decisions/README.md`).

## Scope

- `src/upgrade.ts` + `src/commands/upgrade.ts`, `install.sh`, `install.ps1`,
  release build script (per-platform `--compile` + SHA-256), CI release
  workflow, `package.json` `files`/`bin`/`prepublishOnly`.

## TDD plan

1. **Red** — `upgrade`: `--dry-run` reports target without writing; checksum
   mismatch aborts; npm-install path advises package manager instead of
   self-replacing.
2. **Green** — implement upgrade env + command.
3. **Refactor** — share fetch/verify helpers.

## Acceptance criteria

- [x] `bun run build` (npm) and `bun run build:bin` produce artifacts
- [x] Installer downloads + verifies checksum + installs to PATH
- [x] `gdrive upgrade --dry-run` works; checksum mismatch aborts
- [x] `bun run test`, `bun run typecheck` pass

Notes:

- The npm `build` now passes `--packages external`, so `dist/index.js` is 121 KB
  and resolves the declared dependencies at runtime instead of bundling a 22 MB
  copy of them. `--compile` builds still bundle everything.
- `upgrade` throws `AppError` (API_ERROR / IO_ERROR) instead of returning an
  error variant, so it flows through the shared error handling of 0007.
- `scripts/build-release.ts` is the single source of the asset names; they must
  stay in sync with `assetNameFor` in `src/upgrade.ts` and both installers.
- `tsconfig`/`lint`/`format` now also cover `scripts/`.

Verified locally: `bun run build` + `node dist/index.js --version`;
`bun run build:bin`; `bun run build:release` produced all five binaries and a
`SHA256SUMS` that `sha256sum -c` accepts and `parseSha256Sums` reads, with
`assetNameFor` matching every asset name; the compiled binary ran real Drive
commands and `upgrade --dry-run` correctly reported the (not yet existing)
release, while the Bun-run CLI took the "use your package manager" path.
Not verified: an actual GitHub release / npm publish, and `install.ps1`
(only `bash -n install.sh` was run).

## Verification

- `bun run test src/upgrade.test.ts`
- Manual: run `install.sh` against a draft release
