import { Command } from "commander";
import type { CommandResult, OutputFormat } from "../../types/index.ts";
import { line, renderSuccess } from "../../lib/output.ts";
import { resolveRangeWith, type SheetTab } from "../../lib/sheets-api.ts";

export interface SheetsClearDeps {
  resolvePath: (arg: string) => Promise<string>;
  listTabs: (spreadsheetId: string) => Promise<SheetTab[]>;
  clearValues: (spreadsheetId: string, range: string) => Promise<string>;
  file: string;
  range: string;
  tab?: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleSheetsClear(deps: SheetsClearDeps): Promise<CommandResult> {
  const spreadsheetId = await deps.resolvePath(deps.file);
  const a1 = await resolveRangeWith(() => deps.listTabs(spreadsheetId), {
    range: deps.range,
    ...(deps.tab !== undefined ? { tab: deps.tab } : {}),
  });

  const clearedRange = await deps.clearValues(spreadsheetId, a1);
  const message = `Cleared ${clearedRange}`;

  // Quiet clear emits nothing (decision 0010); JSON still prints the envelope.
  const rendered = renderSuccess(
    {
      data: { id: spreadsheetId, cleared_range: clearedRange, message },
      text: line`Cleared ${clearedRange}`,
      quiet: "",
    },
    deps.format,
    deps.quiet,
  );
  if (rendered !== "") deps.write(rendered);
  return { exitCode: 0 };
}

export function createSheetsClearCommand(): Command {
  return new Command("clear")
    .description("Clear the values in a range")
    .argument("<file>", "Spreadsheet ID or path")
    .argument("<range>", "A1 range, optionally tab-qualified")
    .option("--tab <name>", "Tab to clear when the range omits one");
}
