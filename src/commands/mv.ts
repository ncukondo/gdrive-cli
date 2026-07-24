import { Command } from "commander";
import type { CommandResult, DriveFile, OutputFormat } from "../types/index.ts";
import { renderSuccess } from "../lib/output.ts";

export interface MvDeps {
  resolvePath: (arg: string) => Promise<string>;
  moveFile: (fileId: string, newParentId: string) => Promise<DriveFile>;
  file: string;
  dest: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleMv(deps: MvDeps): Promise<CommandResult> {
  const fileId = await deps.resolvePath(deps.file);
  const destId = await deps.resolvePath(deps.dest);
  const file = await deps.moveFile(fileId, destId);

  deps.write(
    renderSuccess(
      {
        data: { file },
        text: `Moved ${file.name} to ${destId}`,
        quiet: file.id,
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createMvCommand(): Command {
  return new Command("mv")
    .description("Move a file to another folder")
    .argument("<file>", "File ID or path")
    .argument("<folder>", "Destination folder ID or path");
}
