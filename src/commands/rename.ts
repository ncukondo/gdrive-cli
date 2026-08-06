import { Command } from "commander";
import { AppError, type CommandResult, type DriveFile, type OutputFormat } from "../types/index.ts";
import { formatValues, line, renderSuccess } from "../lib/output.ts";

export interface RenameDeps {
  /** The file to rename, as an entry: renaming a shortcut renames the shortcut. */
  resolvePath: (arg: string) => Promise<string>;
  renameFile: (fileId: string, name: string) => Promise<DriveFile>;
  file: string;
  name: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
  warn: (msg: string) => void;
}

/**
 * Renames a file (decision 0052). The argument is an entry — 0025 §1's role
 * table — so a shortcut is renamed rather than what it points at.
 */
export async function handleRename(deps: RenameDeps): Promise<CommandResult> {
  // Before the path walk, which is itself a Drive call: Drive would take a
  // blank name and leave a file nothing can address by path.
  if (deps.name.trim() === "") {
    throw new AppError("INVALID_ARGS", "<name> is empty.");
  }
  const fileId = await deps.resolvePath(deps.file);
  const renamed = await deps.renameFile(fileId, deps.name);

  deps.write(
    renderSuccess(
      {
        data: { file: renamed },
        text: line`Renamed to ${renamed.name} (${renamed.id})`,
        quiet: formatValues([renamed.id]),
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createRenameCommand(): Command {
  return new Command("rename")
    .description("Change a file's name")
    .argument("<file>", "File ID or path")
    .argument("<name>", "New name");
}
