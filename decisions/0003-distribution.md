# 0003: Distribution & upgrade

Date: 2026-07-24
Status: accepted

## Context

Users install CLIs in different ways: as an npm global, via `npx`, or as a
self-contained binary with no runtime. We mirror the model proven in
[`yaml-form-cli`](https://github.com/ncukondo/yaml-form-cli).

## Decision

Ship three ways:

1. **npm package** `@ncukondo/gdrive-cli` (`bin: { gdrive }`), usable via
   `npm i -g` or `npx @ncukondo/gdrive-cli` / `bunx`.
2. **Single-file executable** per platform (linux/macOS x64 & arm64, windows
   x64), built with `bun build --compile`, published to GitHub Releases with a
   SHA-256 checksum.
3. **Installer scripts** `install.sh` (Linux/macOS) and `install.ps1`
   (Windows) that download the right binary from Releases, verify its
   checksum, and place it on PATH (default `~/.local/bin`). Honor
   `GDRIVE_CLI_VERSION` to pin and `GDRIVE_CLI_INSTALL_DIR` to relocate.

Self-update: **`gdrive upgrade`** updates a binary install in place (fetch
latest release, verify checksum, atomic replace-self; `--dry-run` reports the
target version without changing anything). npm installs are told to upgrade via
their package manager instead.

## Consequences

- A release task produces binaries + checksums and updates the installer.
- `upgrade` logic (fetch latest, download, verify, replace-self) is adapted
  from yaml-form-cli's `src/upgrade.ts`, renamed for gdrive.
