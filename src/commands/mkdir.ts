import { Command } from "commander";
import type { CommandResult, DriveFile, OutputFormat } from "../types/index.ts";
import { formatValues, line, renderSuccess } from "../lib/output.ts";

export interface MkdirDeps {
  resolvePath: (arg: string) => Promise<string>;
  createFolder: (name: string, parentId?: string) => Promise<DriveFile>;
  name: string;
  parent?: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleMkdir(deps: MkdirDeps): Promise<CommandResult> {
  const parentId = deps.parent !== undefined ? await deps.resolvePath(deps.parent) : undefined;
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
