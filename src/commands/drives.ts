import { Command } from "commander";
import type { CommandResult, OutputFormat, SharedDrive } from "../types/index.ts";
import { formatTable, renderSuccess } from "../lib/output.ts";

/**
 * Renders shared drives as tab-separated rows (decisions 0016, 0036 §2). The ID
 * field is what `--parent`, `mv`, `cp`, and `ls` take, so it is never elided.
 */
export function formatDriveTable(drives: SharedDrive[]): string {
  if (drives.length === 0) return "No shared drives.";
  return formatTable(
    ["Name", "ID"],
    drives.map((d) => [d.name, d.id]),
  );
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
