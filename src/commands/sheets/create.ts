import { Command } from "commander";
import type { CommandResult, OutputFormat } from "../../types/index.ts";
import { formatValues, line, renderSuccess } from "../../lib/output.ts";
import { MY_DRIVE, refuseUnaddressableName, type FindSiblings } from "../../lib/names.ts";
import { ROOT_ID } from "../../lib/resolve-path.ts";
import { afterCreate } from "../../lib/after-create.ts";

export interface SheetsCreateDeps {
  resolvePath: (arg: string) => Promise<string>;
  createSpreadsheet: (title: string) => Promise<{ id: string; title: string }>;
  /** Drive move — the Sheets API cannot create a spreadsheet inside a folder. */
  moveFile: (spreadsheetId: string, parentId: string) => Promise<unknown>;
  /** What the title would collide with where the deck lands (decision 0055 §1). */
  findSiblings: FindSiblings;
  title: string;
  parent?: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

/**
 * Decision 0055 §2 is what puts `--parent` ahead of the create: the title is the
 * Drive name, and a refusal after `spreadsheets.create` would leave a
 * spreadsheet the caller has to go and delete. Resolving the folder first costs
 * nothing extra — it was resolved either way.
 */
export async function handleSheetsCreate(deps: SheetsCreateDeps): Promise<CommandResult> {
  const parentId = deps.parent !== undefined ? await deps.resolvePath(deps.parent) : undefined;
  await refuseUnaddressableName({
    name: deps.title,
    parentId: parentId ?? ROOT_ID,
    findSiblings: deps.findSiblings,
    where: deps.parent ?? MY_DRIVE,
  });

  const created = await deps.createSpreadsheet(deps.title);
  // Nothing to fill: `spreadsheets.create` hands back a usable spreadsheet, so
  // the move is the only call that can fail once one exists. It goes through
  // `afterCreate` anyway, for the id it puts on that failure.
  await afterCreate(created, { parentId, moveFile: deps.moveFile }, async () => {});

  deps.write(
    renderSuccess(
      {
        data: {
          id: created.id,
          title: created.title,
          ...(parentId !== undefined ? { parent_id: parentId } : {}),
        },
        text: line`Created ${created.title} (${created.id})`,
        quiet: formatValues([created.id]),
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
