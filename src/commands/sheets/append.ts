import { Command } from "commander";
import type { CommandResult, OutputFormat } from "../../types/index.ts";
import { renderSuccess } from "../../lib/output.ts";
import {
  resolveRangeWith,
  type InputMode,
  type SheetTab,
  type UpdateResult,
} from "../../lib/sheets-api.ts";
import { parseInputMode, readGrid } from "./write.ts";

export interface SheetsAppendDeps {
  resolvePath: (arg: string) => Promise<string>;
  listTabs: (spreadsheetId: string) => Promise<SheetTab[]>;
  appendValues: (
    spreadsheetId: string,
    range: string,
    values: string[][],
    mode: InputMode,
  ) => Promise<UpdateResult>;
  readInput: (arg: string) => Promise<string>;
  file: string;
  values: string;
  range?: string;
  tab?: string;
  inputMode?: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleSheetsAppend(deps: SheetsAppendDeps): Promise<CommandResult> {
  const mode = parseInputMode(deps.inputMode);
  const grid = await readGrid(deps.readInput, deps.values);

  const spreadsheetId = await deps.resolvePath(deps.file);
  const a1 = await resolveRangeWith(() => deps.listTabs(spreadsheetId), {
    ...(deps.range !== undefined ? { range: deps.range } : {}),
    ...(deps.tab !== undefined ? { tab: deps.tab } : {}),
  });

  const result = await deps.appendValues(spreadsheetId, a1, grid, mode);
  const message = `Appended ${result.updated_rows} rows to ${result.updated_range}`;

  deps.write(
    renderSuccess(
      {
        data: { id: spreadsheetId, ...result, message },
        text: message,
        quiet: String(result.updated_cells),
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createSheetsAppendCommand(): Command {
  return new Command("append")
    .description("Append rows after the existing table")
    .argument("<file>", "Spreadsheet ID or path")
    .argument("[range]", "A1 range to search for the table (whole tab if omitted)")
    .requiredOption("--values <csv|json|@file|->", "Values as CSV or a JSON 2-D array")
    .option("--tab <name>", "Tab to append to when the range omits one")
    .option("--input-mode <mode>", "raw (default) | user (Sheets parses formulas/dates)");
}
