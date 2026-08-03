import { describe, expect, it, vi } from "vitest";
import {
  appendValues,
  buildRange,
  clearValues,
  createSpreadsheet,
  firstVisibleTab,
  formatCsv,
  formatValuesTable,
  listTabs,
  parseCsv,
  parseValues,
  readValues,
  resolveRangeWith,
  writeValues,
  type SheetsClient,
  type SheetTab,
  type SpreadsheetRaw,
} from "./sheets-api.ts";
import { callArgs } from "../../tests/helpers/mock.ts";

type ValuesUpdateParam = Parameters<SheetsClient["spreadsheets"]["values"]["update"]>[0];
type ValuesAppendParam = Parameters<SheetsClient["spreadsheets"]["values"]["append"]>[0];

const spreadsheet: SpreadsheetRaw = {
  spreadsheetId: "S1",
  properties: { title: "Budget" },
  sheets: [
    {
      properties: {
        sheetId: 0,
        index: 0,
        title: "Sheet1",
        gridProperties: { rowCount: 100, columnCount: 26 },
      },
    },
    {
      properties: {
        sheetId: 7,
        index: 1,
        title: "Summary",
        hidden: true,
        gridProperties: { rowCount: 50, columnCount: 10 },
      },
    },
  ],
};

function mockSheets(
  overrides: Partial<SheetsClient["spreadsheets"]> = {},
  valueOverrides: Partial<SheetsClient["spreadsheets"]["values"]> = {},
): SheetsClient {
  return {
    spreadsheets: {
      get: vi.fn(async () => ({ data: spreadsheet })),
      create: vi.fn(async () => ({ data: spreadsheet })),
      ...overrides,
      values: {
        get: vi.fn(async () => ({ data: { range: "Sheet1!A1:B2", values: [] } })),
        update: vi.fn(async () => ({ data: {} })),
        append: vi.fn(async () => ({ data: {} })),
        clear: vi.fn(async () => ({ data: {} })),
        ...valueOverrides,
      },
    },
  };
}

describe("parseCsv", () => {
  it("splits rows and cells", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("honors RFC 4180 quoting", () => {
    expect(parseCsv('"a,1","say ""hi""","multi\nline"')).toEqual([
      ["a,1", 'say "hi"', "multi\nline"],
    ]);
  });

  it("handles CRLF and a trailing newline", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps empty cells", () => {
    expect(parseCsv("a,,c")).toEqual([["a", "", "c"]]);
  });
});

describe("formatCsv", () => {
  it("quotes only cells that need it", () => {
    expect(
      formatCsv([
        ["a", "b,1"],
        ['say "hi"', "multi\nline"],
      ]),
    ).toBe('a,"b,1"\n"say ""hi""","multi\nline"');
  });

  it("returns an empty string for no rows", () => {
    expect(formatCsv([])).toBe("");
  });
});

describe("parseValues", () => {
  it("parses a JSON 2-D array", () => {
    expect(parseValues('[["a","b"],["c",2]]')).toEqual([
      ["a", "b"],
      ["c", "2"],
    ]);
  });

  it("falls back to CSV", () => {
    expect(parseValues("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("rejects malformed JSON and non 2-D arrays", () => {
    expect(() => parseValues("[[")).toThrow(/JSON/);
    expect(() => parseValues('["a","b"]')).toThrow(/2-D/);
  });
});

describe("formatValuesTable", () => {
  it("separates cells with one tab and pads nothing (decision 0036 §2)", () => {
    expect(
      formatValuesTable([
        ["name", "score"],
        ["alice", "9"],
      ]),
    ).toBe("name\tscore\nalice\t9");
  });

  it("keeps a short row short and returns empty for no values", () => {
    expect(formatValuesTable([["a", "b"], ["c"]])).toBe("a\tb\nc");
    expect(formatValuesTable([])).toBe("");
  });

  it("round-trips every cell, whatever the widest cell of the column is", () => {
    const grid = [
      ["名前", "メモ"],
      ["alice", "x".repeat(40)],
      ["", "9"],
    ];
    expect(
      formatValuesTable(grid)
        .split("\n")
        .map((row) => row.split("\t")),
    ).toEqual(grid);
  });

  // A supplement to the round trip above: constant-width padding leaves rows
  // independent, so the round trip is what guards decision 0036 §2 (0039 §2).
  it("leaves every other row byte-identical when one cell grows", () => {
    const grid = [
      ["name", "score"],
      ["alice", "9"],
    ];
    const before = formatValuesTable(grid).split("\n");
    const after = formatValuesTable([
      ["a-considerably-longer-name", "score"],
      ["alice", "9"],
    ]).split("\n");
    expect(after.slice(1)).toEqual(before.slice(1));
  });
});

describe("buildRange", () => {
  it("passes through a tab-qualified range", () => {
    expect(buildRange({ range: "Summary!A1:B2", defaultTab: "Sheet1" })).toBe("Summary!A1:B2");
  });

  it("qualifies a bare range with --tab or the default tab", () => {
    expect(buildRange({ range: "A1:B2", tab: "Summary" })).toBe("Summary!A1:B2");
    expect(buildRange({ range: "A1:B2", defaultTab: "Sheet1" })).toBe("Sheet1!A1:B2");
  });

  it("targets the whole tab when no range is given", () => {
    expect(buildRange({ defaultTab: "Sheet1" })).toBe("Sheet1");
    expect(buildRange({ tab: "Summary" })).toBe("Summary");
  });

  it("quotes tab titles that need it", () => {
    expect(buildRange({ range: "A1", tab: "My Sheet" })).toBe("'My Sheet'!A1");
    expect(buildRange({ tab: "Bob's" })).toBe("'Bob''s'");
  });

  it("fails when no tab can be determined", () => {
    expect(() => buildRange({ range: "A1:B2" })).toThrow(/tab/i);
  });
});

describe("resolveRangeWith", () => {
  it("skips the tab lookup for a qualified range or an explicit --tab", async () => {
    const fetchTabs = vi.fn(async (): Promise<SheetTab[]> => []);
    expect(await resolveRangeWith(fetchTabs, { range: "Summary!A1" })).toBe("Summary!A1");
    expect(await resolveRangeWith(fetchTabs, { range: "A1", tab: "Summary" })).toBe("Summary!A1");
    expect(fetchTabs).not.toHaveBeenCalled();
  });

  it("falls back to the first visible tab", async () => {
    const fetchTabs = vi.fn(async () => [
      { index: 0, title: "Hidden", sheet_id: 1, rows: 1, cols: 1, hidden: true },
      { index: 1, title: "Data", sheet_id: 2, rows: 1, cols: 1, hidden: false },
    ]);
    expect(await resolveRangeWith(fetchTabs, { range: "A1:B2" })).toBe("Data!A1:B2");
    expect(await resolveRangeWith(fetchTabs, {})).toBe("Data");
  });
});

describe("tabs", () => {
  it("listTabs normalizes sheet properties", async () => {
    const tabs = await listTabs(mockSheets(), "S1");
    expect(tabs).toEqual([
      { index: 0, title: "Sheet1", sheet_id: 0, rows: 100, cols: 26, hidden: false },
      { index: 1, title: "Summary", sheet_id: 7, rows: 50, cols: 10, hidden: true },
    ]);
  });

  it("firstVisibleTab skips hidden sheets", () => {
    expect(
      firstVisibleTab([
        { index: 0, title: "Hidden", sheet_id: 1, rows: 1, cols: 1, hidden: true },
        { index: 1, title: "Data", sheet_id: 2, rows: 1, cols: 1, hidden: false },
      ]),
    ).toBe("Data");
    expect(firstVisibleTab([])).toBeUndefined();
  });
});

describe("value operations", () => {
  it("readValues stringifies cells and pads nothing", async () => {
    const get = vi.fn(async () => ({
      data: { range: "Sheet1!A1:B2", values: [["name", "score"], ["alice", 90], ["bob"]] },
    }));
    const result = await readValues(mockSheets({}, { get }), "S1", "Sheet1!A1:B2");
    expect(get).toHaveBeenCalledWith({ spreadsheetId: "S1", range: "Sheet1!A1:B2" });
    expect(result).toEqual({
      range: "Sheet1!A1:B2",
      values: [["name", "score"], ["alice", "90"], ["bob"]],
    });
  });

  it("readValues returns an empty grid when the range has no values", async () => {
    const get = vi.fn(async () => ({ data: { range: "Sheet1!A1:B2" } }));
    expect((await readValues(mockSheets({}, { get }), "S1", "Sheet1!A1:B2")).values).toEqual([]);
  });

  it("writeValues sends RAW by default and reports counts", async () => {
    const update = vi.fn(async () => ({
      data: { updatedRange: "Sheet1!A1:B3", updatedRows: 3, updatedColumns: 2, updatedCells: 6 },
    }));
    const result = await writeValues(mockSheets({}, { update }), "S1", "Sheet1!A1", [["a"]], "raw");
    expect(update).toHaveBeenCalledWith({
      spreadsheetId: "S1",
      range: "Sheet1!A1",
      valueInputOption: "RAW",
      requestBody: { values: [["a"]] },
    });
    expect(result).toEqual({
      updated_range: "Sheet1!A1:B3",
      updated_rows: 3,
      updated_columns: 2,
      updated_cells: 6,
    });
  });

  it("writeValues honors the user input mode", async () => {
    const update = vi.fn(async (_params: ValuesUpdateParam) => ({ data: {} }));
    await writeValues(mockSheets({}, { update }), "S1", "Sheet1!A1", [["=1+1"]], "user");
    expect(callArgs(update)[0]).toMatchObject({ valueInputOption: "USER_ENTERED" });
  });

  it("appendValues reads counts from the updates envelope", async () => {
    const append = vi.fn(async (_params: ValuesAppendParam) => ({
      data: {
        updates: {
          updatedRange: "Sheet1!A4:B5",
          updatedRows: 2,
          updatedColumns: 2,
          updatedCells: 4,
        },
      },
    }));
    const result = await appendValues(
      mockSheets({}, { append }),
      "S1",
      "Sheet1",
      [["a", "b"]],
      "raw",
    );
    expect(callArgs(append)[0]).toMatchObject({
      spreadsheetId: "S1",
      range: "Sheet1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
    });
    expect(result).toEqual({
      updated_range: "Sheet1!A4:B5",
      updated_rows: 2,
      updated_columns: 2,
      updated_cells: 4,
    });
  });

  it("clearValues returns the cleared range", async () => {
    const clear = vi.fn(async () => ({ data: { clearedRange: "Sheet1!A1:B2" } }));
    expect(await clearValues(mockSheets({}, { clear }), "S1", "Sheet1!A1:B2")).toBe("Sheet1!A1:B2");
  });

  it("maps API errors", async () => {
    const get = vi.fn(async () => {
      throw Object.assign(new Error("gone"), { code: 404 });
    });
    await expect(readValues(mockSheets({}, { get }), "S1", "A1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("createSpreadsheet", () => {
  it("sends the title and returns id + title", async () => {
    const create = vi.fn(async () => ({
      data: { spreadsheetId: "NEW", properties: { title: "Budget" } },
    }));
    expect(await createSpreadsheet(mockSheets({ create }), "Budget")).toEqual({
      id: "NEW",
      title: "Budget",
    });
    expect(create).toHaveBeenCalledWith({ requestBody: { properties: { title: "Budget" } } });
  });
});
