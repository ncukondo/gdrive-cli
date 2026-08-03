import { Command } from "commander";
import type { CommandResult, DriveFile, OutputFormat } from "../types/index.ts";
import { renderSuccess } from "../lib/output.ts";

export interface MvDeps {
  /** The file to move, as an entry in a folder: a shortcut moves itself. */
  resolvePath: (arg: string) => Promise<string>;
  /** The destination, as a container: a shortcut to a folder moves *into* it. */
  resolveFolder: (arg: string) => Promise<string>;
  moveFile: (fileId: string, newParentId: string) => Promise<DriveFile>;
  file: string;
  dest: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

/**
 * `mv` is why decision 0025 attaches following to the argument rather than the
 * command: its two arguments play different roles, so they get different deps.
 */
export async function handleMv(deps: MvDeps): Promise<CommandResult> {
  const fileId = await deps.resolvePath(deps.file);
  const destId = await deps.resolveFolder(deps.dest);
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
