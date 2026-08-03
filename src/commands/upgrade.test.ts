import { describe, expect, it } from "vitest";
import { formatUpgradeText, handleUpgrade, upgradeData } from "./upgrade.ts";
import type { UpgradeOutcome } from "../upgrade.ts";

function collect() {
  const lines: string[] = [];
  return {
    write: (m: string) => lines.push(m),
    get output() {
      return lines.join("\n");
    },
  };
}

const outcomes = {
  notBinary: { kind: "not-binary", package: "@ncukondo/gdrive-cli" },
  upToDate: { kind: "up-to-date", version: "0.1.0" },
  dryRun: { kind: "dry-run", current: "0.1.0", latest: "0.2.0", asset: "gdrive-linux-x64" },
  upgraded: { kind: "upgraded", from: "0.1.0", to: "0.2.0" },
} satisfies Record<string, UpgradeOutcome>;

describe("formatUpgradeText", () => {
  it("advises the package manager for a runtime install", () => {
    const text = formatUpgradeText(outcomes.notBinary);
    expect(text).toContain("npm install -g @ncukondo/gdrive-cli@latest");
    expect(text).toContain("bun add -g @ncukondo/gdrive-cli@latest");
  });

  it("describes each outcome", () => {
    expect(formatUpgradeText(outcomes.upToDate)).toBe("Already up to date (v0.1.0).");
    expect(formatUpgradeText(outcomes.dryRun)).toBe(
      "Would upgrade v0.1.0 -> v0.2.0 using gdrive-linux-x64.",
    );
    expect(formatUpgradeText(outcomes.upgraded)).toBe("Upgraded to v0.2.0.");
  });

  /**
   * Every branch, not the three that were easy to reach. `runUpgrade` derives
   * both the dry-run and the upgraded version from the same `release.tag_name`,
   * so sanitising one and not the other rests on `git check-ref-format` — a
   * claim about a producer, which is the standard this table stopped accepting.
   */
  it("keeps every branch on one line, whatever the release named", () => {
    const bad = "0.2.0\nUpgraded to v9.9.9";
    for (const text of [
      formatUpgradeText({ kind: "upgraded", from: "0.1.0", to: bad }),
      formatUpgradeText({ kind: "up-to-date", version: bad }),
      formatUpgradeText({ kind: "dry-run", current: "0.1.0", latest: bad, asset: "a" }),
    ]) {
      expect(text.split("\n")).toHaveLength(1);
    }
    // `not-binary` is three lines by design; no value may add a fourth.
    expect(
      formatUpgradeText({ kind: "not-binary", package: "pkg\nrm -rf /" }).split("\n"),
    ).toHaveLength(3);
  });
});

describe("upgradeData", () => {
  it("exposes a stable status and version fields", () => {
    expect(upgradeData(outcomes.dryRun)).toEqual({
      status: "dry-run",
      current_version: "0.1.0",
      latest_version: "0.2.0",
      asset: "gdrive-linux-x64",
    });
    expect(upgradeData(outcomes.upgraded)).toEqual({
      status: "upgraded",
      current_version: "0.1.0",
      latest_version: "0.2.0",
    });
    expect(upgradeData(outcomes.upToDate)).toEqual({
      status: "up-to-date",
      current_version: "0.1.0",
    });
    expect(upgradeData(outcomes.notBinary)).toEqual({
      status: "not-binary",
      package: "@ncukondo/gdrive-cli",
    });
  });
});

describe("handleUpgrade", () => {
  it("passes --dry-run through and renders text", async () => {
    const out = collect();
    let seen: { dryRun?: boolean } | undefined;
    await handleUpgrade({
      runUpgrade: async (options) => {
        seen = options;
        return outcomes.dryRun;
      },
      dryRun: true,
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(seen).toEqual({ dryRun: true });
    expect(out.output).toBe("Would upgrade v0.1.0 -> v0.2.0 using gdrive-linux-x64.");
  });

  it("prints the target version in quiet mode", async () => {
    const out = collect();
    await handleUpgrade({
      runUpgrade: async () => outcomes.upgraded,
      format: "text",
      quiet: true,
      write: out.write,
    });
    expect(out.output).toBe("0.2.0");
  });

  it("emits the envelope in JSON mode", async () => {
    const out = collect();
    await handleUpgrade({
      runUpgrade: async () => outcomes.upToDate,
      format: "json",
      quiet: false,
      write: out.write,
    });
    expect(JSON.parse(out.output)).toEqual({
      success: true,
      data: { status: "up-to-date", current_version: "0.1.0" },
    });
  });

  it("propagates upgrade failures", async () => {
    await expect(
      handleUpgrade({
        runUpgrade: async () => {
          throw new (class extends Error {
            code = "API_ERROR";
          })("checksum mismatch");
        },
        format: "text",
        quiet: false,
        write: () => {},
      }),
    ).rejects.toMatchObject({ code: "API_ERROR" });
  });
});
