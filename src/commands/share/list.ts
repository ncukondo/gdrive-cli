import { Command } from "commander";
import type { CommandResult, DrivePermission, OutputFormat } from "../../types/index.ts";
import { renderSuccess } from "../../lib/output.ts";

const ROLE_W = 11;
const TYPE_W = 8;
const GRANTEE_W = 24;

/** Human label for a permission's grantee (decision 0011). */
export function granteeLabel(permission: DrivePermission): string {
  if (permission.email) return permission.email;
  if (permission.domain) return permission.domain;
  if (permission.type === "anyone") return "(anyone with link)";
  return "(unknown)";
}

/** Renders permissions as an aligned text table (decision 0011). */
export function formatPermissionTable(permissions: DrivePermission[]): string {
  if (permissions.length === 0) return "No permissions.";
  const header =
    "Role".padEnd(ROLE_W) + "Type".padEnd(TYPE_W) + "Grantee".padEnd(GRANTEE_W) + "Permission ID";
  const rows = permissions.map(
    (p) => p.role.padEnd(ROLE_W) + p.type.padEnd(TYPE_W) + granteeLabel(p).padEnd(GRANTEE_W) + p.id,
  );
  return [header, ...rows].join("\n");
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
        quiet: permissions.map((p) => p.id).join("\n"),
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
