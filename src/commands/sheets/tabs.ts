import { Command } from "commander";
import type { CommandResult, OutputFormat } from "../../types/index.ts";
import { formatTable, formatValues, renderSuccess } from "../../lib/output.ts";
import type { SheetTab } from "../../lib/sheets-api.ts";

/** Renders tabs as tab-separated rows (decisions 0010, 0036 §2). */
export function formatTabTable(tabs: SheetTab[]): string {
  if (tabs.length === 0) return "No tabs.";
  return formatTable(
    ["Index", "Rows", "Cols", "Title"],
    tabs.map((t) => [String(t.index), String(t.rows), String(t.cols), t.title]),
  );
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
        quiet: formatValues(tabs.map((t) => t.title)),
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
