import { Command } from "commander";
import type { CommandResult, DriveFile, OutputFormat } from "../types/index.ts";
import { formatValues, line, renderSuccess } from "../lib/output.ts";
import { MY_DRIVE, refuseUnaddressableName, type FindSiblings } from "../lib/names.ts";
import { ROOT_ID } from "../lib/resolve-path.ts";

export interface MkdirDeps {
  resolvePath: (arg: string) => Promise<string>;
  createFolder: (name: string, parentId?: string) => Promise<DriveFile>;
  /** What the new folder's name would collide with (decision 0055 §1). */
  findSiblings: FindSiblings;
  name: string;
  parent?: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleMkdir(deps: MkdirDeps): Promise<CommandResult> {
  const parentId = deps.parent !== undefined ? await deps.resolvePath(deps.parent) : undefined;

  // Decision 0055 §1–§2: the folder this lands in is known before anything is
  // created, so the refusal costs one query and leaves nothing to undo. Without
  // `--parent` that folder is the My Drive root, which is a folder like any
  // other — the root alias is what a path walk starts from, and Drive resolves
  // it in the query the same way.
  await refuseUnaddressableName({
    name: deps.name,
    parentId: parentId ?? ROOT_ID,
    findSiblings: deps.findSiblings,
    where: deps.parent ?? MY_DRIVE,
  });

  const folder = await deps.createFolder(deps.name, parentId);

  deps.write(
    renderSuccess(
      {
        data: { file: folder },
        text: line`Created folder ${folder.name} (${folder.id})`,
        quiet: formatValues([folder.id]),
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createMkdirCommand(): Command {
  return new Command("mkdir")
    .description("Create a folder")
    .argument("<name>", "New folder name")
    .option("--parent <folder>", "Parent folder ID or path (My Drive root if omitted)");
}
