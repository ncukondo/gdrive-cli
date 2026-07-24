import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  assetNameFor,
  compareVersions,
  isRuntimeInstall,
  parseSha256Sums,
  runUpgrade,
  type ReleaseInfo,
  type UpgradeEnv,
} from "./upgrade.ts";

const BINARY = new Uint8Array([1, 2, 3, 4]);
const BINARY_SHA = createHash("sha256").update(BINARY).digest("hex");

function release(overrides: Partial<ReleaseInfo> = {}): ReleaseInfo {
  return {
    tag_name: "v9.9.9",
    assets: [
      { name: "gdrive-linux-x64", browser_download_url: "https://dl/gdrive-linux-x64" },
      { name: "SHA256SUMS", browser_download_url: "https://dl/SHA256SUMS" },
    ],
    ...overrides,
  };
}

function env(overrides: Partial<UpgradeEnv> = {}): UpgradeEnv {
  return {
    currentVersion: "0.1.0",
    execPath: "/home/u/.local/bin/gdrive",
    platform: "linux",
    arch: "x64",
    fetchJson: vi.fn(async (): Promise<unknown> => release()),
    download: vi.fn(async (url: string) =>
      url.endsWith("SHA256SUMS")
        ? new TextEncoder().encode(`${BINARY_SHA}  gdrive-linux-x64\n`)
        : BINARY,
    ),
    replaceSelf: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("compareVersions", () => {
  it("compares numerically and ignores a leading v", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("v2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0", "v0.1.0")).toBe(0);
  });
});

describe("assetNameFor", () => {
  it("maps supported platform/arch pairs", () => {
    expect(assetNameFor("linux", "x64")).toBe("gdrive-linux-x64");
    expect(assetNameFor("darwin", "arm64")).toBe("gdrive-darwin-arm64");
    expect(assetNameFor("win32", "x64")).toBe("gdrive-windows-x64.exe");
  });

  it("returns undefined for unsupported combinations", () => {
    expect(assetNameFor("freebsd", "x64")).toBeUndefined();
    expect(assetNameFor("linux", "riscv64")).toBeUndefined();
  });
});

describe("isRuntimeInstall", () => {
  it("detects node/bun interpreters", () => {
    expect(isRuntimeInstall("/usr/bin/node")).toBe(true);
    expect(isRuntimeInstall("C:\\Program Files\\nodejs\\node.exe")).toBe(true);
    expect(isRuntimeInstall("/home/u/.bun/bin/bun")).toBe(true);
    expect(isRuntimeInstall("/home/u/.local/bin/gdrive")).toBe(false);
  });
});

describe("parseSha256Sums", () => {
  it("reads sha256sum output, including the binary-mode asterisk", () => {
    const sums = parseSha256Sums(`${"a".repeat(64)}  gdrive-linux-x64\n${"b".repeat(64)} *x.exe\n`);
    expect(sums.get("gdrive-linux-x64")).toBe("a".repeat(64));
    expect(sums.get("x.exe")).toBe("b".repeat(64));
  });
});

describe("runUpgrade", () => {
  it("advises the package manager for a runtime install and touches nothing", async () => {
    const e = env({ execPath: "/usr/bin/node" });
    const result = await runUpgrade(e, {});
    expect(result).toEqual({ kind: "not-binary", package: "@ncukondo/gdrive-cli" });
    expect(e.fetchJson).not.toHaveBeenCalled();
    expect(e.replaceSelf).not.toHaveBeenCalled();
  });

  it("reports up-to-date when the release is not newer", async () => {
    const e = env({
      currentVersion: "9.9.9",
      fetchJson: vi.fn(async (): Promise<unknown> => release()),
    });
    expect(await runUpgrade(e, {})).toEqual({ kind: "up-to-date", version: "9.9.9" });
    expect(e.download).not.toHaveBeenCalled();
  });

  it("--dry-run reports the target without downloading or writing", async () => {
    const e = env();
    expect(await runUpgrade(e, { dryRun: true })).toEqual({
      kind: "dry-run",
      current: "0.1.0",
      latest: "9.9.9",
      asset: "gdrive-linux-x64",
    });
    expect(e.download).not.toHaveBeenCalled();
    expect(e.replaceSelf).not.toHaveBeenCalled();
  });

  it("downloads, verifies the checksum, and replaces the binary", async () => {
    const e = env();
    expect(await runUpgrade(e, {})).toEqual({ kind: "upgraded", from: "0.1.0", to: "9.9.9" });
    expect(e.replaceSelf).toHaveBeenCalledWith("/home/u/.local/bin/gdrive", BINARY);
  });

  it("aborts on a checksum mismatch without replacing the binary", async () => {
    const e = env({
      download: vi.fn(async (url: string) =>
        url.endsWith("SHA256SUMS")
          ? new TextEncoder().encode(`${"0".repeat(64)}  gdrive-linux-x64\n`)
          : BINARY,
      ),
    });
    await expect(runUpgrade(e, {})).rejects.toMatchObject({ code: "API_ERROR" });
    await expect(runUpgrade(e, {})).rejects.toThrow(/checksum mismatch/i);
    expect(e.replaceSelf).not.toHaveBeenCalled();
  });

  it("aborts when SHA256SUMS has no entry for the asset", async () => {
    const e = env({
      download: vi.fn(async (url: string) =>
        url.endsWith("SHA256SUMS")
          ? new TextEncoder().encode(`${"0".repeat(64)}  other-binary\n`)
          : BINARY,
      ),
    });
    await expect(runUpgrade(e, {})).rejects.toThrow(/no entry/i);
    expect(e.replaceSelf).not.toHaveBeenCalled();
  });

  it("fails when the release lacks the asset or the checksum file", async () => {
    await expect(
      runUpgrade(env({ fetchJson: vi.fn(async () => release({ assets: [] })) }), {}),
    ).rejects.toMatchObject({ code: "API_ERROR" });
  });

  it("fails for an unsupported platform", async () => {
    await expect(runUpgrade(env({ platform: "freebsd" }), {})).rejects.toThrow(/freebsd/);
  });

  it("surfaces a failed or malformed release lookup", async () => {
    await expect(
      runUpgrade(
        env({
          fetchJson: vi.fn(async () => {
            throw new Error("network down");
          }),
        }),
        {},
      ),
    ).rejects.toThrow(/network down/);

    await expect(
      runUpgrade(env({ fetchJson: vi.fn(async () => ({ assets: [] })) }), {}),
    ).rejects.toThrow(/malformed/);
  });

  it("wraps a failed self-replace as IO_ERROR", async () => {
    const e = env({
      replaceSelf: vi.fn(async () => {
        throw new Error("EACCES");
      }),
    });
    await expect(runUpgrade(e, {})).rejects.toMatchObject({ code: "IO_ERROR" });
  });
});
