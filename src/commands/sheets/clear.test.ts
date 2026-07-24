import { describe, expect, it, vi } from "vitest";
import { handleSheetsClear } from "./clear.ts";
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
];

const baseDeps = () => ({
  resolvePath: vi.fn(async () => "S1"),
  listTabs: vi.fn(async () => tabs),
  clearValues: vi.fn(async (_id: string, _range: string) => "Sheet1!A1:B2"),
  file: "Budget",
  range: "A1:B2",
  format: "text" as const,
  quiet: false,
  write: () => {},
});

describe("handleSheetsClear", () => {
  it("clears the resolved range", async () => {
    const d = baseDeps();
    const out = collect();
    await handleSheetsClear({ ...d, write: out.write });
    expect(d.clearValues).toHaveBeenCalledWith("S1", "Sheet1!A1:B2");
    expect(out.output).toBe("Cleared Sheet1!A1:B2");
  });

  it("honors --tab", async () => {
    const d = baseDeps();
    await handleSheetsClear({ ...d, tab: "Summary" });
    expect(d.listTabs).not.toHaveBeenCalled();
    expect(d.clearValues).toHaveBeenCalledWith("S1", "Summary!A1:B2");
  });

  it("prints nothing in quiet mode but keeps the JSON envelope", async () => {
    const q = collect();
    await handleSheetsClear({ ...baseDeps(), quiet: true, write: q.write });
    expect(q.output).toBe("");

    const j = collect();
    await handleSheetsClear({ ...baseDeps(), format: "json", write: j.write });
    expect(JSON.parse(j.output)).toEqual({
      success: true,
      data: { id: "S1", cleared_range: "Sheet1!A1:B2", message: "Cleared Sheet1!A1:B2" },
    });
  });
});
