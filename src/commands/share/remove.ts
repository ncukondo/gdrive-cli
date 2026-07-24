import { Command } from "commander";
import {
  AppError,
  type CommandResult,
  type DrivePermission,
  type OutputFormat,
} from "../../types/index.ts";
import { renderSuccess } from "../../lib/output.ts";

export interface ShareRemoveDeps {
  resolvePath: (arg: string) => Promise<string>;
  listPermissions: (fileId: string) => Promise<DrivePermission[]>;
  deletePermission: (fileId: string, permissionId: string) => Promise<void>;
  file: string;
  to?: string;
  permissionId?: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleShareRemove(deps: ShareRemoveDeps): Promise<CommandResult> {
  const given = [deps.to !== undefined, deps.permissionId !== undefined].filter(Boolean).length;
  if (given === 0) {
    throw new AppError("INVALID_ARGS", "Specify --to <email> or --permission-id <id>.");
  }
  if (given > 1) {
    throw new AppError("INVALID_ARGS", "Use only one of --to or --permission-id.");
  }

  const fileId = await deps.resolvePath(deps.file);

  let permissionId = deps.permissionId;
  if (permissionId === undefined) {
    const wanted = (deps.to as string).toLowerCase();
    const match = (await deps.listPermissions(fileId)).find(
      (p) => p.email !== null && p.email.toLowerCase() === wanted,
    );
    if (!match) {
      throw new AppError("NOT_FOUND", `No permission for ${deps.to} on ${deps.file}.`);
    }
    permissionId = match.id;
  }

  await deps.deletePermission(fileId, permissionId);

  // Quiet remove emits nothing (decision 0011); JSON still prints the envelope.
  const rendered = renderSuccess(
    {
      data: { id: fileId, permission_id: permissionId, removed: true },
      text: `Removed permission ${permissionId} from ${fileId}`,
      quiet: "",
    },
    deps.format,
    deps.quiet,
  );
  if (rendered !== "") deps.write(rendered);
  return { exitCode: 0 };
}

export function createShareRemoveCommand(): Command {
  return new Command("remove")
    .description("Revoke access to a file")
    .argument("<file>", "File ID or path")
    .option("--to <email>", "Revoke the permission held by this email address")
    .option("--permission-id <id>", "Revoke this permission id");
}
