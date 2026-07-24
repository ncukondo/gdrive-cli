#!/usr/bin/env bun
/**
 * Builds the release artifacts (decision 0003): one `bun build --compile`
 * binary per supported platform plus a SHA256SUMS file, all under `out/`.
 * The release workflow uploads whatever this script produces.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = "out";
const ENTRY = "src/index.ts";
const CHECKSUM_FILE = "SHA256SUMS";

/** Keep in sync with `assetNameFor` in `src/upgrade.ts` and the installers. */
const TARGETS = [
  { bunTarget: "bun-linux-x64", asset: "gdrive-linux-x64" },
  { bunTarget: "bun-linux-arm64", asset: "gdrive-linux-arm64" },
  { bunTarget: "bun-darwin-x64", asset: "gdrive-darwin-x64" },
  { bunTarget: "bun-darwin-arm64", asset: "gdrive-darwin-arm64" },
  { bunTarget: "bun-windows-x64", asset: "gdrive-windows-x64.exe" },
];

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

for (const { bunTarget, asset } of TARGETS) {
  process.stdout.write(`Compiling ${asset} (${bunTarget})...\n`);
  execFileSync(
    "bun",
    ["build", ENTRY, "--compile", `--target=${bunTarget}`, "--outfile", join(OUT_DIR, asset)],
    { stdio: "inherit" },
  );
}

const sums = TARGETS.map(({ asset }) => {
  const digest = createHash("sha256")
    .update(readFileSync(join(OUT_DIR, asset)))
    .digest("hex");
  return `${digest}  ${asset}`;
}).join("\n");
writeFileSync(join(OUT_DIR, CHECKSUM_FILE), `${sums}\n`);

process.stdout.write(`\nWrote ${TARGETS.length} binaries + ${CHECKSUM_FILE} to ${OUT_DIR}/\n`);
