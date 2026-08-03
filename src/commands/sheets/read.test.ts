import { describe, expect, it, vi } from "vitest";
import { handleSheetsRead, parseValuesAs } from "./read.ts";
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

const values = [
  ["name", "score"],
  ["alice", "90"],
];

const baseDeps = () => ({
  resolvePath: vi.fn(async () => "S1"),
  listTabs: vi.fn(async () => tabs),
  readValues: vi.fn(async (_id: string, _range: string) => ({
    range: "Sheet1!A1:B2",
    values,
  })),
  file: "Budget",
  format: "text" as const,
  quiet: false,
  write: () => {},
});

describe("parseValuesAs", () => {
  it("defaults to table and accepts csv/json", () => {
    expect(parseValuesAs(undefined)).toBe("table");
    expect(parseValuesAs("csv")).toBe("csv");
    expect(parseValuesAs("json")).toBe("json");
  });

  it("rejects unknown encodings", () => {
    expect(() => parseValuesAs("yaml")).toThrow(/Invalid --as/);
  });
});

describe("handleSheetsRead", () => {
  it("defaults to the first visible tab when no range is given", async () => {
    const d = baseDeps();
    await handleSheetsRead({ ...d });
    expect(d.listTabs).toHaveBeenCalledWith("S1");
    expect(d.readValues).toHaveBeenCalledWith("S1", "Sheet1");
  });

  it("qualifies a bare range with --tab without listing tabs", async () => {
    const d = baseDeps();
    await handleSheetsRead({ ...d, range: "A1:B2", tab: "Summary" });
    expect(d.listTabs).not.toHaveBeenCalled();
    expect(d.readValues).toHaveBeenCalledWith("S1", "Summary!A1:B2");
  });

  it("renders a tab-separated table by default", async () => {
    const out = collect();
    await handleSheetsRead({ ...baseDeps(), write: out.write });
    expect(out.output).toBe("name\tscore\nalice\t90");
  });

  it("renders CSV and JSON with --as", async () => {
    const csv = collect();
    await handleSheetsRead({ ...baseDeps(), as: "csv", write: csv.write });
    expect(csv.output).toBe("name,score\nalice,90");

    const json = collect();
    await handleSheetsRead({ ...baseDeps(), as: "json", write: json.write });
    expect(JSON.parse(json.output)).toEqual(values);
  });

  it("prints CSV in quiet mode", async () => {
    const out = collect();
    await handleSheetsRead({ ...baseDeps(), quiet: true, write: out.write });
    expect(out.output).toBe("name,score\nalice,90");
  });

  it("emits range, values, rows, and cols in the JSON envelope", async () => {
    const out = collect();
    await handleSheetsRead({ ...baseDeps(), format: "json", write: out.write });
    expect(JSON.parse(out.output)).toEqual({
      success: true,
      data: { id: "S1", range: "Sheet1!A1:B2", values, rows: 2, cols: 2 },
    });
  });

  it("reports an empty range as zero rows and cols", async () => {
    const out = collect();
    await handleSheetsRead({
      ...baseDeps(),
      readValues: vi.fn(async () => ({ range: "Sheet1!A1:B2", values: [] })),
      format: "json",
      write: out.write,
    });
    expect(JSON.parse(out.output).data).toMatchObject({ rows: 0, cols: 0, values: [] });
  });
});
