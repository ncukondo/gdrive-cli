import { describe, expect, it, vi } from "vitest";
import { handleSheetsWrite, parseInputMode } from "./write.ts";
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
  updated_range: "Sheet1!A1:B3",
  updated_rows: 3,
  updated_columns: 2,
  updated_cells: 6,
};

const baseDeps = () => ({
  resolvePath: vi.fn(async () => "S1"),
  listTabs: vi.fn(async () => tabs),
  writeValues: vi.fn(
    async (_id: string, _range: string, _values: string[][], _mode: "raw" | "user") => result,
  ),
  readInput: vi.fn(async (arg: string) => arg),
  file: "Budget",
  range: "A1:B3",
  values: "a,b\nc,d",
  format: "text" as const,
  quiet: false,
  write: () => {},
});

describe("parseInputMode", () => {
  it("defaults to raw and accepts user", () => {
    expect(parseInputMode(undefined)).toBe("raw");
    expect(parseInputMode("user")).toBe("user");
    expect(parseInputMode("raw")).toBe("raw");
  });

  it("rejects unknown modes", () => {
    expect(() => parseInputMode("smart")).toThrow(/Invalid --input-mode/);
  });
});

describe("handleSheetsWrite", () => {
  it("parses CSV values and writes RAW to the resolved range", async () => {
    const d = baseDeps();
    const out = collect();
    await handleSheetsWrite({ ...d, write: out.write });
    expect(d.readInput).toHaveBeenCalledWith("a,b\nc,d");
    expect(d.writeValues).toHaveBeenCalledWith(
      "S1",
      "Sheet1!A1:B3",
      [
        ["a", "b"],
        ["c", "d"],
      ],
      "raw",
    );
    expect(out.output).toBe("Updated 6 cells in Sheet1!A1:B3");
  });

  it("accepts JSON values and --input-mode user", async () => {
    const d = baseDeps();
    await handleSheetsWrite({
      ...d,
      values: '[["=1+1"]]',
      readInput: vi.fn(async (arg: string) => arg),
      inputMode: "user",
    });
    expect(d.writeValues).toHaveBeenCalledWith("S1", "Sheet1!A1:B3", [["=1+1"]], "user");
  });

  it("rejects empty values with INVALID_ARGS", async () => {
    await expect(
      handleSheetsWrite({ ...baseDeps(), values: "", readInput: vi.fn(async () => "") }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
  });

  it("prints the updated cell count in quiet mode and the counts in JSON", async () => {
    const q = collect();
    await handleSheetsWrite({ ...baseDeps(), quiet: true, write: q.write });
    expect(q.output).toBe("6");

    const j = collect();
    await handleSheetsWrite({ ...baseDeps(), format: "json", write: j.write });
    expect(JSON.parse(j.output)).toEqual({
      success: true,
      data: {
        id: "S1",
        updated_range: "Sheet1!A1:B3",
        updated_rows: 3,
        updated_columns: 2,
        updated_cells: 6,
        message: "Updated 6 cells in Sheet1!A1:B3",
      },
    });
  });
});
