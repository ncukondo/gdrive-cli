import { Command } from "commander";
import type { CommandResult, OutputFormat, SharedDrive } from "../types/index.ts";
import { renderSuccess } from "../lib/output.ts";

const NAME_W = 32;

/**
 * Renders shared drives as an aligned text table (decision 0016). The ID column
 * is what `--parent`, `mv`, `cp`, and `ls` take, so it is never elided.
 */
export function formatDriveTable(drives: SharedDrive[]): string {
  if (drives.length === 0) return "No shared drives.";
  const header = "Name".padEnd(NAME_W) + "ID";
  const rows = drives.map((d) => d.name.padEnd(NAME_W) + d.id);
  return [header, ...rows].join("\n");
}

export interface DrivesDeps {
  listSharedDrives: () => Promise<SharedDrive[]>;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleDrives(deps: DrivesDeps): Promise<CommandResult> {
  const drives = await deps.listSharedDrives();

  deps.write(
    renderSuccess(
      {
        data: { drives },
        text: formatDriveTable(drives),
        quiet: drives.map((d) => d.id).join("\n"),
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createDrivesCommand(): Command {
  return new Command("drives").description(
    "List the shared drives this account can see, with their IDs",
  );
}
