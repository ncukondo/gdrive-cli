import { Command } from "commander";
import type { CommandResult, OutputFormat } from "../../types/index.ts";
import { line, renderSuccess } from "../../lib/output.ts";

export interface SheetsCreateDeps {
  resolvePath: (arg: string) => Promise<string>;
  createSpreadsheet: (title: string) => Promise<{ id: string; title: string }>;
  /** Drive move — the Sheets API cannot create a spreadsheet inside a folder. */
  moveFile: (spreadsheetId: string, parentId: string) => Promise<unknown>;
  title: string;
  parent?: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleSheetsCreate(deps: SheetsCreateDeps): Promise<CommandResult> {
  const created = await deps.createSpreadsheet(deps.title);

  let parentId: string | undefined;
  if (deps.parent !== undefined) {
    parentId = await deps.resolvePath(deps.parent);
    await deps.moveFile(created.id, parentId);
  }

  deps.write(
    renderSuccess(
      {
        data: {
          id: created.id,
          title: created.title,
          ...(parentId !== undefined ? { parent_id: parentId } : {}),
        },
        text: line`Created ${created.title} (${created.id})`,
        quiet: created.id,
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createSheetsCreateCommand(): Command {
  return new Command("create")
    .description("Create a new spreadsheet")
    .argument("<title>", "Spreadsheet title")
    .option("--parent <folder>", "Parent folder ID or path");
}
