import { Command } from "commander";
import type { CommandResult, DriveFile, OutputFormat } from "../types/index.ts";
import { line, renderSuccess } from "../lib/output.ts";

export interface RmDeps {
  resolvePath: (arg: string) => Promise<string>;
  trashFile: (fileId: string) => Promise<DriveFile>;
  deleteFile: (fileId: string) => Promise<void>;
  file: string;
  permanent?: boolean;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleRm(deps: RmDeps): Promise<CommandResult> {
  const fileId = await deps.resolvePath(deps.file);

  let data: unknown;
  let text: string;
  if (deps.permanent) {
    await deps.deleteFile(fileId);
    data = { id: fileId, deleted: true };
    text = line`Permanently deleted ${fileId}`;
  } else {
    const file = await deps.trashFile(fileId);
    data = { file, trashed: true };
    text = line`Trashed ${file.name} (${fileId})`;
  }

  // Quiet rm emits nothing (decision 0008); JSON still prints the envelope.
  const rendered = renderSuccess({ data, text, quiet: "" }, deps.format, deps.quiet);
  if (rendered !== "") deps.write(rendered);
  return { exitCode: 0 };
}

export function createRmCommand(): Command {
  return new Command("rm")
    .description("Trash a file (default) or delete it permanently")
    .argument("<file>", "File ID or path")
    .option("--permanent", "Delete permanently instead of trashing");
}
