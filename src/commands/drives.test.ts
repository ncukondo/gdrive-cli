import { describe, expect, it } from "vitest";
import { createDrivesCommand, formatDriveTable, handleDrives } from "./drives.ts";
import type { SharedDrive } from "../types/index.ts";

function collect() {
  const lines: string[] = [];
  return {
    write: (m: string) => lines.push(m),
    get output() {
      return lines.join("\n");
    },
  };
}

const drives: SharedDrive[] = [
  { id: "0ANPgzMZtaAa6Uk9PVA", name: "専門医部会" },
  { id: "0AAbCdEfGhIjKlMnOpQ", name: "Finance" },
];

describe("formatDriveTable", () => {
  it("renders a header and one row per drive", () => {
    const table = formatDriveTable(drives);
    expect(table).toContain("Name");
    expect(table).toContain("ID");
    expect(table).toContain("Finance");
    expect(table).toContain("0ANPgzMZtaAa6Uk9PVA");
    expect(table.split("\n")).toHaveLength(3);
  });

  it("says so when there are none", () => {
    expect(formatDriveTable([])).toBe("No shared drives.");
  });
});

describe("handleDrives", () => {
  it("renders a text table", async () => {
    const out = collect();
    await handleDrives({
      listSharedDrives: async () => drives,
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(out.output).toContain("専門医部会");
  });

  it("renders JSON under data.drives", async () => {
    const out = collect();
    await handleDrives({
      listSharedDrives: async () => drives,
      format: "json",
      quiet: false,
      write: out.write,
    });
    expect(JSON.parse(out.output)).toEqual({ success: true, data: { drives } });
  });

  it("renders quiet as one id per line, ready for --parent", async () => {
    const out = collect();
    await handleDrives({
      listSharedDrives: async () => drives,
      format: "text",
      quiet: true,
      write: out.write,
    });
    expect(out.output).toBe("0ANPgzMZtaAa6Uk9PVA\n0AAbCdEfGhIjKlMnOpQ");
  });

  it("returns an empty array in JSON when the account has none", async () => {
    const out = collect();
    await handleDrives({
      listSharedDrives: async () => [],
      format: "json",
      quiet: false,
      write: out.write,
    });
    expect(JSON.parse(out.output)).toEqual({ success: true, data: { drives: [] } });
  });
});

describe("createDrivesCommand", () => {
  it("takes no arguments", () => {
    const command = createDrivesCommand();
    expect(command.name()).toBe("drives");
    expect(command.registeredArguments).toHaveLength(0);
  });
});
