import { describe, expect, it, vi } from "vitest";
import { handleSheetsTabs } from "./tabs.ts";
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

describe("handleSheetsTabs", () => {
  it("lists tabs as an aligned table", async () => {
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
      ["Index  Rows  Cols  Title", "0      100   26    Sheet1", "1      50    10    Summary"].join(
        "\n",
      ),
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
