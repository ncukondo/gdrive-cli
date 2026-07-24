import { Command } from "commander";
import type { CommandResult, OutputFormat } from "../../types/index.ts";
import { renderSuccess } from "../../lib/output.ts";
import { parseChoice } from "../../lib/args.ts";
import {
  formatCsv,
  formatValuesTable,
  resolveRangeWith,
  type SheetTab,
} from "../../lib/sheets-api.ts";

export type ValuesEncoding = "table" | "csv" | "json";

const VALID_AS: ValuesEncoding[] = ["table", "csv", "json"];

/** Validates `--as`, defaulting to `table` (decision 0010). */
export function parseValuesAs(value: string | undefined): ValuesEncoding {
  return value === undefined ? "table" : parseChoice(VALID_AS, value, "--as");
}

function encodeValues(values: string[][], as: ValuesEncoding): string {
  if (as === "csv") return formatCsv(values);
  if (as === "json") return JSON.stringify(values, null, 2);
  return formatValuesTable(values);
}

export interface SheetsReadDeps {
  resolvePath: (arg: string) => Promise<string>;
  listTabs: (spreadsheetId: string) => Promise<SheetTab[]>;
  readValues: (
    spreadsheetId: string,
    range: string,
  ) => Promise<{ range: string; values: string[][] }>;
  file: string;
  range?: string;
  tab?: string;
  as?: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleSheetsRead(deps: SheetsReadDeps): Promise<CommandResult> {
  const as = parseValuesAs(deps.as);
  const spreadsheetId = await deps.resolvePath(deps.file);
  const a1 = await resolveRangeWith(() => deps.listTabs(spreadsheetId), {
    ...(deps.range !== undefined ? { range: deps.range } : {}),
    ...(deps.tab !== undefined ? { tab: deps.tab } : {}),
  });

  const result = await deps.readValues(spreadsheetId, a1);
  const cols = result.values.reduce((max, row) => Math.max(max, row.length), 0);

  deps.write(
    renderSuccess(
      {
        data: {
          id: spreadsheetId,
          range: result.range,
          values: result.values,
          rows: result.values.length,
          cols,
        },
        text: encodeValues(result.values, as),
        quiet: formatCsv(result.values),
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createSheetsReadCommand(): Command {
  return new Command("read")
    .description("Read values from a range (the whole tab if omitted)")
    .argument("<file>", "Spreadsheet ID or path")
    .argument("[range]", "A1 range, optionally tab-qualified")
    .option("--tab <name>", "Tab to read when the range omits one")
    .option("--as <encoding>", "Render as: table | csv | json (default table)");
}
