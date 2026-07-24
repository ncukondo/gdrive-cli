import { Command } from "commander";
import { AppError, type CommandResult, type OutputFormat } from "../../types/index.ts";
import { renderSuccess } from "../../lib/output.ts";
import {
  parseValues,
  resolveRangeWith,
  type InputMode,
  type SheetTab,
  type UpdateResult,
} from "../../lib/sheets-api.ts";

const VALID_MODES: InputMode[] = ["raw", "user"];

/** Validates `--input-mode`, defaulting to `raw` (decision 0010). */
export function parseInputMode(value: string | undefined): InputMode {
  if (value === undefined) return "raw";
  if (!VALID_MODES.includes(value as InputMode)) {
    throw new AppError(
      "INVALID_ARGS",
      `Invalid --input-mode "${value}". Use: ${VALID_MODES.join(", ")}.`,
    );
  }
  return value as InputMode;
}

/** Reads `--values` through the @file/stdin reader and parses CSV or JSON. */
export async function readGrid(
  readInput: (arg: string) => Promise<string>,
  values: string,
): Promise<string[][]> {
  const raw = await readInput(values);
  if (raw.trim() === "") {
    throw new AppError("INVALID_ARGS", "--values is empty.");
  }
  return parseValues(raw);
}

export interface SheetsWriteDeps {
  resolvePath: (arg: string) => Promise<string>;
  listTabs: (spreadsheetId: string) => Promise<SheetTab[]>;
  writeValues: (
    spreadsheetId: string,
    range: string,
    values: string[][],
    mode: InputMode,
  ) => Promise<UpdateResult>;
  readInput: (arg: string) => Promise<string>;
  file: string;
  range: string;
  values: string;
  tab?: string;
  inputMode?: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleSheetsWrite(deps: SheetsWriteDeps): Promise<CommandResult> {
  const mode = parseInputMode(deps.inputMode);
  const grid = await readGrid(deps.readInput, deps.values);

  const spreadsheetId = await deps.resolvePath(deps.file);
  const a1 = await resolveRangeWith(() => deps.listTabs(spreadsheetId), {
    range: deps.range,
    ...(deps.tab !== undefined ? { tab: deps.tab } : {}),
  });

  const result = await deps.writeValues(spreadsheetId, a1, grid, mode);
  const message = `Updated ${result.updated_cells} cells in ${result.updated_range}`;

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

export function createSheetsWriteCommand(): Command {
  return new Command("write")
    .description("Overwrite a range with values")
    .argument("<file>", "Spreadsheet ID or path")
    .argument("<range>", "A1 range, optionally tab-qualified")
    .requiredOption("--values <csv|json|@file|->", "Values as CSV or a JSON 2-D array")
    .option("--tab <name>", "Tab to write when the range omits one")
    .option("--input-mode <mode>", "raw (default) | user (Sheets parses formulas/dates)");
}
