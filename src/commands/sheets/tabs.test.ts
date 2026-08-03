import { describe, expect, it, vi } from "vitest";
import { formatTabTable, handleSheetsTabs } from "./tabs.ts";
import type { SheetTab } from "../../lib/sheets-api.ts";

function collect() {
  const lines: string[] = [];
  return {
    write: (m: string) => lines.push(m),
    get output() {
      return lines.join("\n");
    },
  };
}

const tabs: SheetTab[] = [
  { index: 0, title: "Sheet1", sheet_id: 0, rows: 100, cols: 26, hidden: false },
  { index: 1, title: "Summary", sheet_id: 7, rows: 50, cols: 10, hidden: true },
];

describe("formatTabTable", () => {
  it("round-trips every field of every row", () => {
    const rows = formatTabTable(tabs).split("\n").slice(1);
    expect(rows.map((row) => row.split("\t"))).toEqual([
      ["0", "100", "26", "Sheet1"],
      ["1", "50", "10", "Summary"],
    ]);
  });

  // A supplement to the round trip above: constant-width padding leaves rows
  // independent, so the round trip is what guards decision 0036 §2 (0039 §2).
  it("leaves every other row byte-identical when one title grows", () => {
    const before = formatTabTable(tabs).split("\n");
    const longer = tabs.map((t, i) => (i === 0 ? { ...t, title: "回答 1 — シート" } : t));
    const after = formatTabTable(longer).split("\n");
    expect(after.filter((_, i) => i !== 1)).toEqual(before.filter((_, i) => i !== 1));
  });
});

describe("handleSheetsTabs", () => {
  it("lists tabs as tab-separated rows", async () => {
    const resolvePath = vi.fn(async () => "S1");
    const out = collect();
    await handleSheetsTabs({
      resolvePath,
      listTabs: async () => tabs,
      file: "Budget",
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(resolvePath).toHaveBeenCalledWith("Budget");
    expect(out.output).toBe(
      ["Index\tRows\tCols\tTitle", "0\t100\t26\tSheet1", "1\t50\t10\tSummary"].join("\n"),
    );
  });

  it("prints one title per line in quiet mode", async () => {
    const out = collect();
    await handleSheetsTabs({
      resolvePath: async () => "S1",
      listTabs: async () => tabs,
      file: "S1",
      format: "text",
      quiet: true,
      write: out.write,
    });
    expect(out.output).toBe("Sheet1\nSummary");
  });

  it("emits the tabs array in JSON and handles an empty spreadsheet", async () => {
    const out = collect();
    await handleSheetsTabs({
      resolvePath: async () => "S1",
      listTabs: async () => tabs,
      file: "S1",
      format: "json",
      quiet: false,
      write: out.write,
    });
    expect(JSON.parse(out.output)).toEqual({ success: true, data: { id: "S1", tabs } });

    const empty = collect();
    await handleSheetsTabs({
      resolvePath: async () => "S1",
      listTabs: async () => [],
      file: "S1",
      format: "text",
      quiet: false,
      write: empty.write,
    });
    expect(empty.output).toBe("No tabs.");
  });
});
