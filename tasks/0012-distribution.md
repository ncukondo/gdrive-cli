# Task 0012: Distribution, installer & `upgrade`

Status: todo
Depends on: 0007, 0008, 0009, 0010, 0014
Parallel: no

## Goal

Ship npm build, single-file binaries, installer scripts, and `gdrive upgrade`,
per `decisions/0003`.

## Context

- Relevant decisions: `decisions/0003-distribution.md`
- Adapt yaml-form-cli's `src/upgrade.ts` and installer scripts.

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

- [ ] `bun run build` (npm) and `bun run build:bin` produce artifacts
- [ ] Installer downloads + verifies checksum + installs to PATH
- [ ] `gdrive upgrade --dry-run` works; checksum mismatch aborts
- [ ] `bun run test`, `bun run typecheck` pass

## Verification

- `bun run test src/upgrade.test.ts`
- Manual: run `install.sh` against a draft release
