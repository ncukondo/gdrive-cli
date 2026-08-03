import { chmod, rename, rm, writeFile } from "node:fs/promises";
import type { Command } from "commander";
import type { CommandResult, OutputFormat } from "../types/index.ts";
import { formatValues, line, renderSuccess } from "../lib/output.ts";
import { runUpgrade, type UpgradeEnv, type UpgradeOutcome } from "../upgrade.ts";
import { resolveGlobalOptions, handleError } from "../index.ts";
import pkg from "../../package.json" with { type: "json" };

/** Human-readable summary of an upgrade outcome (decision 0003). */
export function formatUpgradeText(outcome: UpgradeOutcome): string {
  switch (outcome.kind) {
    case "not-binary":
      return [
        "This install runs via a JS runtime, so upgrade it with your package manager:",
        line`  npm install -g ${outcome.package}@latest`,
        line`  bun add -g ${outcome.package}@latest`,
      ].join("\n");
    case "up-to-date":
      return `Already up to date (v${outcome.version}).`;
    case "dry-run":
      return line`Would upgrade v${outcome.current} -> v${outcome.latest} using ${outcome.asset}.`;
    case "upgraded":
      return `Upgraded to v${outcome.to}.`;
  }
}

/** JSON `data` payload for an upgrade outcome. */
export function upgradeData(outcome: UpgradeOutcome): Record<string, unknown> {
  switch (outcome.kind) {
    case "not-binary":
      return { status: outcome.kind, package: outcome.package };
    case "up-to-date":
      return { status: outcome.kind, current_version: outcome.version };
    case "dry-run":
      return {
        status: outcome.kind,
        current_version: outcome.current,
        latest_version: outcome.latest,
        asset: outcome.asset,
      };
    case "upgraded":
      return {
        status: outcome.kind,
        current_version: outcome.from,
        latest_version: outcome.to,
      };
  }
}

/** Version a script would care about: the target after a successful upgrade. */
function outcomeVersion(outcome: UpgradeOutcome): string {
  switch (outcome.kind) {
    case "not-binary":
      return "";
    case "up-to-date":
      return outcome.version;
    case "dry-run":
      return outcome.latest;
    case "upgraded":
      return outcome.to;
  }
}

export interface UpgradeDeps {
  runUpgrade: (options: { dryRun?: boolean }) => Promise<UpgradeOutcome>;
  dryRun?: boolean;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleUpgrade(deps: UpgradeDeps): Promise<CommandResult> {
  const outcome = await deps.runUpgrade(deps.dryRun ? { dryRun: true } : {});

  const rendered = renderSuccess(
    {
      data: upgradeData(outcome),
      text: formatUpgradeText(outcome),
      quiet: formatValues([outcomeVersion(outcome)]),
    },
    deps.format,
    deps.quiet,
  );
  if (rendered !== "") deps.write(rendered);
  return { exitCode: 0 };
}

/** Wires the real network + filesystem into {@link UpgradeEnv}. */
export function createUpgradeEnv(): UpgradeEnv {
  const userAgent = `gdrive-cli/${pkg.version}`;
  return {
    currentVersion: pkg.version,
    execPath: process.execPath,
    platform: process.platform,
    arch: process.arch,
    fetchJson: async (url) => {
      const res = await fetch(url, {
        headers: { "User-Agent": userAgent, Accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
      return res.json();
    },
    download: async (url) => {
      const res = await fetch(url, { headers: { "User-Agent": userAgent } });
      if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    replaceSelf: async (execPath, data) => {
      const next = `${execPath}.new`;
      await writeFile(next, data);
      await chmod(next, 0o755);
      if (process.platform === "win32") {
        // A running .exe cannot be overwritten, but it can be renamed away.
        await rename(execPath, `${execPath}.old`);
      }
      await rename(next, execPath);
      await rm(`${execPath}.old`, { force: true }).catch(() => {});
    },
  };
}

export function registerUpgrade(program: Command): void {
  const upgrade = program
    .command("upgrade")
    .description("Update a binary install to the latest release")
    .option("--dry-run", "Report the target version without changing anything");

  upgrade.action(async () => {
    const opts = resolveGlobalOptions(program);
    const o = upgrade.opts<{ dryRun?: boolean }>();
    try {
      const result = await handleUpgrade({
        runUpgrade: (options) => runUpgrade(createUpgradeEnv(), options),
        format: opts.format,
        quiet: opts.quiet,
        write: (m) => process.stdout.write(m + "\n"),
        ...(o.dryRun ? { dryRun: true } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
}
