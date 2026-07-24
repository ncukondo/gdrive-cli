import { createHash } from "node:crypto";
import { AppError } from "./types/index.ts";

/**
 * `gdrive upgrade`: replace a compiled-binary install with the latest GitHub
 * release (decision 0003, adapted from yaml-form-cli's `src/upgrade.ts`).
 * Network and file operations live behind {@link UpgradeEnv} so the logic is
 * testable; failures surface as {@link AppError} like every other command.
 */

export const REPO = "ncukondo/gdrive-cli";
export const PACKAGE_NAME = "@ncukondo/gdrive-cli";
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
export const CHECKSUM_ASSET = "SHA256SUMS";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface ReleaseInfo {
  tag_name: string;
  assets: ReleaseAsset[];
}

export interface UpgradeEnv {
  currentVersion: string;
  execPath: string;
  platform: string;
  arch: string;
  fetchJson: (url: string) => Promise<unknown>;
  download: (url: string) => Promise<Uint8Array>;
  replaceSelf: (execPath: string, data: Uint8Array) => Promise<void>;
}

export type UpgradeOutcome =
  | { kind: "not-binary"; package: string }
  | { kind: "up-to-date"; version: string }
  | { kind: "dry-run"; current: string; latest: string; asset: string }
  | { kind: "upgraded"; from: string; to: string };

/** Numeric semver comparison; non-numeric parts compare as 0. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const [pa, pb] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const PLATFORM_NAMES: Record<string, string> = {
  linux: "linux",
  darwin: "darwin",
  win32: "windows",
};
const SUPPORTED_ARCHS = new Set(["x64", "arm64"]);

/** Release asset name for a platform/arch pair, or undefined if unsupported. */
export function assetNameFor(platform: string, arch: string): string | undefined {
  const platformName = PLATFORM_NAMES[platform];
  if (platformName === undefined || !SUPPORTED_ARCHS.has(arch)) return undefined;
  const ext = platform === "win32" ? ".exe" : "";
  return `gdrive-${platformName}-${arch}${ext}`;
}

/** True when running under an interpreter (npm/bunx/dev), not a compiled binary. */
export function isRuntimeInstall(execPath: string): boolean {
  const base = execPath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return ["bun", "bun.exe", "node", "node.exe"].includes(base);
}

/** Parses `sha256sum` output into filename -> digest. */
export function parseSha256Sums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match?.[1] && match[2]) sums.set(match[2], match[1]);
  }
  return sums;
}

async function fetchLatestRelease(env: UpgradeEnv): Promise<ReleaseInfo> {
  let release: ReleaseInfo;
  try {
    release = (await env.fetchJson(LATEST_RELEASE_URL)) as ReleaseInfo;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError("API_ERROR", `Could not fetch the latest release: ${message}`);
  }
  if (typeof release?.tag_name !== "string") {
    throw new AppError("API_ERROR", "Could not fetch the latest release: malformed response.");
  }
  return release;
}

function findAsset(release: ReleaseInfo, name: string): ReleaseAsset {
  const asset = (release.assets ?? []).find((a) => a.name === name);
  if (!asset) {
    throw new AppError("API_ERROR", `Release ${release.tag_name} is missing ${name}.`);
  }
  return asset;
}

async function downloadVerified(
  env: UpgradeEnv,
  binaryAsset: ReleaseAsset,
  sumsAsset: ReleaseAsset,
): Promise<Uint8Array> {
  const sumsData = await env.download(sumsAsset.browser_download_url);
  const binary = await env.download(binaryAsset.browser_download_url);

  const expected = parseSha256Sums(new TextDecoder().decode(sumsData)).get(binaryAsset.name);
  if (expected === undefined) {
    throw new AppError(
      "API_ERROR",
      `${CHECKSUM_ASSET} has no entry for ${binaryAsset.name}; aborting.`,
    );
  }
  const actual = createHash("sha256").update(binary).digest("hex");
  if (expected !== actual) {
    throw new AppError(
      "API_ERROR",
      `Checksum mismatch for ${binaryAsset.name}; aborting (expected ${expected}, got ${actual}).`,
    );
  }
  return binary;
}

export async function runUpgrade(
  env: UpgradeEnv,
  options: { dryRun?: boolean },
): Promise<UpgradeOutcome> {
  if (isRuntimeInstall(env.execPath)) {
    return { kind: "not-binary", package: PACKAGE_NAME };
  }

  const release = await fetchLatestRelease(env);
  const latest = release.tag_name.replace(/^v/, "");
  if (compareVersions(latest, env.currentVersion) <= 0) {
    return { kind: "up-to-date", version: env.currentVersion };
  }

  const assetName = assetNameFor(env.platform, env.arch);
  if (assetName === undefined) {
    throw new AppError("API_ERROR", `No prebuilt binary for ${env.platform}/${env.arch}.`);
  }
  const binaryAsset = findAsset(release, assetName);
  const sumsAsset = findAsset(release, CHECKSUM_ASSET);

  if (options.dryRun) {
    return { kind: "dry-run", current: env.currentVersion, latest, asset: assetName };
  }

  const binary = await downloadVerified(env, binaryAsset, sumsAsset);
  try {
    await env.replaceSelf(env.execPath, binary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError("IO_ERROR", `Failed to replace ${env.execPath}: ${message}`);
  }
  return { kind: "upgraded", from: env.currentVersion, to: latest };
}
