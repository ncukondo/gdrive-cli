import { Command } from "commander";
import type { CommandResult, DriveFile, OutputFormat } from "../types/index.ts";
import { renderSuccess } from "../lib/output.ts";

export interface CpDeps {
  resolvePath: (arg: string) => Promise<string>;
  copyFile: (fileId: string, parentId: string, name?: string) => Promise<DriveFile>;
  file: string;
  dest: string;
  name?: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleCp(deps: CpDeps): Promise<CommandResult> {
  const fileId = await deps.resolvePath(deps.file);
  const destId = await deps.resolvePath(deps.dest);
  const copy = await deps.copyFile(fileId, destId, deps.name);

  deps.write(
    renderSuccess(
      {
        data: { file: copy },
        text: `Copied to ${copy.name} (${copy.id})`,
        quiet: copy.id,
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createCpCommand(): Command {
  return new Command("cp")
    .description("Copy a file into a folder")
    .argument("<file>", "File ID or path")
    .argument("<folder>", "Destination folder ID or path")
    .option("--name <name>", "Name for the copy");
}
