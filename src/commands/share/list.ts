import { Command } from "commander";
import type { CommandResult, DrivePermission, OutputFormat } from "../../types/index.ts";
import { formatTable, formatValues, renderSuccess } from "../../lib/output.ts";

/** Human label for a permission's grantee (decision 0011). */
export function granteeLabel(permission: DrivePermission): string {
  if (permission.email) return permission.email;
  if (permission.domain) return permission.domain;
  if (permission.type === "anyone") return "(anyone with link)";
  return "(unknown)";
}

/** Renders permissions as tab-separated rows (decisions 0011, 0036 §2). */
export function formatPermissionTable(permissions: DrivePermission[]): string {
  if (permissions.length === 0) return "No permissions.";
  return formatTable(
    ["Role", "Type", "Grantee", "Permission ID"],
    permissions.map((p) => [p.role, p.type, granteeLabel(p), p.id]),
  );
}

export interface ShareListDeps {
  resolvePath: (arg: string) => Promise<string>;
  listPermissions: (fileId: string) => Promise<DrivePermission[]>;
  file: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleShareList(deps: ShareListDeps): Promise<CommandResult> {
  const fileId = await deps.resolvePath(deps.file);
  const permissions = await deps.listPermissions(fileId);

  deps.write(
    renderSuccess(
      {
        data: { id: fileId, permissions },
        text: formatPermissionTable(permissions),
        quiet: formatValues(permissions.map((p) => p.id)),
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createShareListCommand(): Command {
  return new Command("list")
    .description("List all permissions on a file")
    .argument("<file>", "File ID or path");
}
