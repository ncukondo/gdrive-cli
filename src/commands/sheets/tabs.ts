import { Command } from "commander";
import type { CommandResult, OutputFormat } from "../../types/index.ts";
import { renderSuccess } from "../../lib/output.ts";
import type { SheetTab } from "../../lib/sheets-api.ts";

const INDEX_W = 7;
const ROWS_W = 6;
const COLS_W = 6;

/** Renders tabs as an aligned text table (decision 0010). */
export function formatTabTable(tabs: SheetTab[]): string {
  if (tabs.length === 0) return "No tabs.";
  const header = "Index".padEnd(INDEX_W) + "Rows".padEnd(ROWS_W) + "Cols".padEnd(COLS_W) + "Title";
  const rows = tabs.map(
    (t) =>
      String(t.index).padEnd(INDEX_W) +
      String(t.rows).padEnd(ROWS_W) +
      String(t.cols).padEnd(COLS_W) +
      t.title,
  );
  return [header, ...rows].join("\n");
}

export interface SheetsTabsDeps {
  resolvePath: (arg: string) => Promise<string>;
  listTabs: (spreadsheetId: string) => Promise<SheetTab[]>;
  file: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleSheetsTabs(deps: SheetsTabsDeps): Promise<CommandResult> {
  const spreadsheetId = await deps.resolvePath(deps.file);
  const tabs = await deps.listTabs(spreadsheetId);

  deps.write(
    renderSuccess(
      {
        data: { id: spreadsheetId, tabs },
        text: formatTabTable(tabs),
        quiet: tabs.map((t) => t.title).join("\n"),
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createSheetsTabsCommand(): Command {
  return new Command("tabs")
    .description("List the tabs (sheets) in a spreadsheet")
    .argument("<file>", "Spreadsheet ID or path");
}
