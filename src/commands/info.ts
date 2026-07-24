import { Command } from "commander";
import type { CommandResult, DriveFile, OutputFormat } from "../types/index.ts";
import { renderSuccess } from "../lib/output.ts";
import { formatFileDetail } from "./file-format.ts";

export interface InfoDeps {
  resolvePath: (arg: string) => Promise<string>;
  getFile: (fileId: string) => Promise<DriveFile>;
  file: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleInfo(deps: InfoDeps): Promise<CommandResult> {
  const fileId = await deps.resolvePath(deps.file);
  const file = await deps.getFile(fileId);

  deps.write(
    renderSuccess(
      { data: { file }, text: formatFileDetail(file), quiet: file.id },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createInfoCommand(): Command {
  return new Command("info")
    .description("Show file metadata")
    .argument("<file>", "File ID or path");
}
