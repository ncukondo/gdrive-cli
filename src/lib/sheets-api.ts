import { z } from "zod";
import { mapDriveError as mapApiError } from "./api.ts";
import { AppError } from "../types/index.ts";

// --- Raw Sheets v4 shapes (only the fields we read) -------------------------

export interface SheetPropertiesRaw {
  sheetId?: number | null;
  index?: number | null;
  title?: string | null;
  hidden?: boolean | null;
  gridProperties?: { rowCount?: number | null; columnCount?: number | null } | null;
}

export interface SpreadsheetRaw {
  spreadsheetId?: string | null;
  properties?: { title?: string | null } | null;
  sheets?: { properties?: SheetPropertiesRaw | null }[] | null;
}

export interface ValueRangeRaw {
  range?: string | null;
  values?: unknown[][] | null;
}

export interface UpdateResultRaw {
  updatedRange?: string | null;
  updatedRows?: number | null;
  updatedColumns?: number | null;
  updatedCells?: number | null;
}

/**
 * Minimal abstraction over `google.sheets({version:"v4"}).spreadsheets` for
 * testability (decision 0012).
 */
export interface SheetsClient {
  spreadsheets: {
    get: (params: { spreadsheetId: string; fields?: string }) => Promise<{ data: SpreadsheetRaw }>;
    create: (params: {
      requestBody: { properties: { title: string } };
    }) => Promise<{ data: SpreadsheetRaw }>;
    values: {
      get: (params: { spreadsheetId: string; range: string }) => Promise<{ data: ValueRangeRaw }>;
      update: (params: {
        spreadsheetId: string;
        range: string;
        valueInputOption: string;
        requestBody: { values: string[][] };
      }) => Promise<{ data: UpdateResultRaw }>;
      append: (params: {
        spreadsheetId: string;
        range: string;
        valueInputOption: string;
        insertDataOption?: string;
        requestBody: { values: string[][] };
      }) => Promise<{ data: { updates?: UpdateResultRaw | null } }>;
      clear: (params: {
        spreadsheetId: string;
        range: string;
      }) => Promise<{ data: { clearedRange?: string | null } }>;
    };
  };
}

export interface SheetTab {
  index: number;
  title: string;
  sheet_id: number;
  rows: number;
  cols: number;
  hidden: boolean;
}

export interface UpdateResult {
  updated_range: string;
  updated_rows: number;
  updated_columns: number;
  updated_cells: number;
}

/** RAW keeps values verbatim; USER_ENTERED lets Sheets parse formulas/dates. */
export type InputMode = "raw" | "user";

// --- CSV / JSON / table codecs (decision 0010) ------------------------------

/** Parses RFC 4180 CSV, including quoted commas, quotes, and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);

  // A trailing newline yields one spurious empty row.
  const last = rows[rows.length - 1];
  if (last && last.length === 1 && last[0] === "") rows.pop();
  return rows;
}

/** Serializes a grid as RFC 4180 CSV. */
export function formatCsv(values: string[][]): string {
  return values
    .map((row) =>
      row.map((cell) => (/[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(","),
    )
    .join("\n");
}

/** A JSON `--values` payload: rows of arbitrary cells, stringified below. */
const GridSchema = z.array(z.array(z.unknown()));

/** Parses `--values` content: a JSON 2-D array, else CSV (decision 0010). */
export function parseValues(text: string): string[][] {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[")) return parseCsv(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError("INVALID_ARGS", `Invalid JSON values: ${message}`);
  }
  const grid = GridSchema.safeParse(parsed);
  if (!grid.success) {
    throw new AppError("INVALID_ARGS", 'JSON values must be a 2-D array, e.g. [["a","b"]].');
  }
  return grid.data.map((row) => row.map(cellToString));
}

function cellToString(cell: unknown): string {
  return cell === null || cell === undefined ? "" : String(cell);
}

/** Renders a grid as aligned columns for human reading. */
export function formatValuesTable(values: string[][]): string {
  if (values.length === 0) return "";
  const widths: number[] = [];
  for (const row of values) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return values
    .map((row) =>
      row
        .map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0)))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

// --- Range resolution -------------------------------------------------------

/** Quotes a tab title for A1 notation when it is not a bare identifier. */
export function quoteTabTitle(title: string): string {
  return /^[A-Za-z0-9_]+$/.test(title) ? title : `'${title.replace(/'/g, "''")}'`;
}

export interface RangeArgs {
  range?: string;
  tab?: string;
  /** First visible tab, used when neither the range nor `--tab` names one. */
  defaultTab?: string;
}

/**
 * Builds an A1 range: a tab-qualified `range` wins, otherwise `--tab` (or the
 * default tab) qualifies it. With no range, the whole tab is targeted (0010).
 */
export function buildRange(args: RangeArgs): string {
  if (args.range !== undefined && args.range.includes("!")) return args.range;
  const tab = args.tab ?? args.defaultTab;
  if (tab === undefined) {
    throw new AppError("INVALID_ARGS", "Could not determine a tab; pass --tab <name>.");
  }
  const quoted = quoteTabTitle(tab);
  return args.range === undefined ? quoted : `${quoted}!${args.range}`;
}

/**
 * {@link buildRange} that fetches the spreadsheet's tabs only when the range
 * needs a default — a qualified range or an explicit `--tab` costs no call.
 */
export async function resolveRangeWith(
  fetchTabs: () => Promise<SheetTab[]>,
  args: { range?: string; tab?: string },
): Promise<string> {
  const needsDefault = args.tab === undefined && !args.range?.includes("!");
  const defaultTab = needsDefault ? firstVisibleTab(await fetchTabs()) : undefined;
  return buildRange({
    ...(args.range !== undefined ? { range: args.range } : {}),
    ...(args.tab !== undefined ? { tab: args.tab } : {}),
    ...(defaultTab !== undefined ? { defaultTab } : {}),
  });
}

// --- Wrapper operations -----------------------------------------------------

export async function listTabs(client: SheetsClient, spreadsheetId: string): Promise<SheetTab[]> {
  try {
    const res = await client.spreadsheets.get({
      spreadsheetId,
      fields: "sheets(properties(sheetId,index,title,hidden,gridProperties(rowCount,columnCount)))",
    });
    return (res.data.sheets ?? []).map((sheet, i) => {
      const p = sheet.properties ?? {};
      return {
        index: p.index ?? i,
        title: p.title ?? "",
        sheet_id: p.sheetId ?? 0,
        rows: p.gridProperties?.rowCount ?? 0,
        cols: p.gridProperties?.columnCount ?? 0,
        hidden: p.hidden ?? false,
      };
    });
  } catch (error) {
    mapApiError(error);
  }
}

/** Title of the first non-hidden tab, or undefined when there is none. */
export function firstVisibleTab(tabs: SheetTab[]): string | undefined {
  return tabs.find((t) => !t.hidden)?.title;
}

export async function readValues(
  client: SheetsClient,
  spreadsheetId: string,
  range: string,
): Promise<{ range: string; values: string[][] }> {
  try {
    const res = await client.spreadsheets.values.get({ spreadsheetId, range });
    return {
      range: res.data.range ?? range,
      values: (res.data.values ?? []).map((row) => row.map(cellToString)),
    };
  } catch (error) {
    mapApiError(error);
  }
}

function normalizeUpdate(raw: UpdateResultRaw | null | undefined, range: string): UpdateResult {
  return {
    updated_range: raw?.updatedRange ?? range,
    updated_rows: raw?.updatedRows ?? 0,
    updated_columns: raw?.updatedColumns ?? 0,
    updated_cells: raw?.updatedCells ?? 0,
  };
}

function inputOption(mode: InputMode): string {
  return mode === "user" ? "USER_ENTERED" : "RAW";
}

export async function writeValues(
  client: SheetsClient,
  spreadsheetId: string,
  range: string,
  values: string[][],
  mode: InputMode,
): Promise<UpdateResult> {
  try {
    const res = await client.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: inputOption(mode),
      requestBody: { values },
    });
    return normalizeUpdate(res.data, range);
  } catch (error) {
    mapApiError(error);
  }
}

export async function appendValues(
  client: SheetsClient,
  spreadsheetId: string,
  range: string,
  values: string[][],
  mode: InputMode,
): Promise<UpdateResult> {
  try {
    const res = await client.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: inputOption(mode),
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });
    return normalizeUpdate(res.data.updates, range);
  } catch (error) {
    mapApiError(error);
  }
}

export async function clearValues(
  client: SheetsClient,
  spreadsheetId: string,
  range: string,
): Promise<string> {
  try {
    const res = await client.spreadsheets.values.clear({ spreadsheetId, range });
    return res.data.clearedRange ?? range;
  } catch (error) {
    mapApiError(error);
  }
}

export async function createSpreadsheet(
  client: SheetsClient,
  title: string,
): Promise<{ id: string; title: string }> {
  try {
    const res = await client.spreadsheets.create({ requestBody: { properties: { title } } });
    return { id: res.data.spreadsheetId ?? "", title: res.data.properties?.title ?? title };
  } catch (error) {
    mapApiError(error);
  }
}
