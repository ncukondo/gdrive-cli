import { describe, expect, it, vi } from "vitest";
import { handleSheetsAppend } from "./append.ts";
import type { SheetTab, UpdateResult } from "../../lib/sheets-api.ts";

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

const result: UpdateResult = {
  updated_range: "Sheet1!A4:B5",
  updated_rows: 2,
  updated_columns: 2,
  updated_cells: 4,
};

const baseDeps = () => ({
  resolvePath: vi.fn(async () => "S1"),
  listTabs: vi.fn(async () => tabs),
  appendValues: vi.fn(
    async (_id: string, _range: string, _values: string[][], _mode: "raw" | "user") => result,
  ),
  readInput: vi.fn(async (arg: string) => arg),
  file: "Budget",
  values: "a,b\nc,d",
  format: "text" as const,
  quiet: false,
  write: () => {},
});

describe("handleSheetsAppend", () => {
  it("appends to the whole first visible tab when no range is given", async () => {
    const d = baseDeps();
    const out = collect();
    await handleSheetsAppend({ ...d, write: out.write });
    expect(d.appendValues).toHaveBeenCalledWith(
      "S1",
      "Sheet1",
      [
        ["a", "b"],
        ["c", "d"],
      ],
      "raw",
    );
    expect(out.output).toBe("Appended 2 rows to Sheet1!A4:B5");
  });

  it("honors an explicit range and --input-mode", async () => {
    const d = baseDeps();
    await handleSheetsAppend({ ...d, range: "Summary!A1:B2", inputMode: "user" });
    expect(d.listTabs).not.toHaveBeenCalled();
    expect(d.appendValues.mock.calls[0]?.[1]).toBe("Summary!A1:B2");
    expect(d.appendValues.mock.calls[0]?.[3]).toBe("user");
  });

  it("rejects empty values", async () => {
    await expect(
      handleSheetsAppend({ ...baseDeps(), values: "", readInput: vi.fn(async () => "") }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
  });

  it("prints the updated cell count in quiet mode and the counts in JSON", async () => {
    const q = collect();
    await handleSheetsAppend({ ...baseDeps(), quiet: true, write: q.write });
    expect(q.output).toBe("4");

    const j = collect();
    await handleSheetsAppend({ ...baseDeps(), format: "json", write: j.write });
    expect(JSON.parse(j.output)).toEqual({
      success: true,
      data: {
        id: "S1",
        updated_range: "Sheet1!A4:B5",
        updated_rows: 2,
        updated_columns: 2,
        updated_cells: 4,
        message: "Appended 2 rows to Sheet1!A4:B5",
      },
    });
  });
});
