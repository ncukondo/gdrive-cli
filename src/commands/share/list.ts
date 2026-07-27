import { Command } from "commander";
import type { CommandResult, DrivePermission, OutputFormat } from "../../types/index.ts";
import { renderSuccess } from "../../lib/output.ts";

/**
 * Column floors, not ceilings: `fileOrganizer` (13 characters, decision 0018)
 * and a long address both overrun the fixed widths this table used, running
 * into the next column. Each width grows to fit its widest value and otherwise
 * stays exactly where it was.
 */
const ROLE_W = 11;
const TYPE_W = 8;
const GRANTEE_W = 24;

const widthOf = (floor: number, values: string[]): number =>
  Math.max(floor, ...values.map((v) => v.length + 1));

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
  const role = widthOf(
    ROLE_W,
    permissions.map((p) => p.role),
  );
  const type = widthOf(
    TYPE_W,
    permissions.map((p) => p.type),
  );
  const grantee = widthOf(GRANTEE_W, permissions.map(granteeLabel));
  const header =
    "Role".padEnd(role) + "Type".padEnd(type) + "Grantee".padEnd(grantee) + "Permission ID";
  const rows = permissions.map(
    (p) => p.role.padEnd(role) + p.type.padEnd(type) + granteeLabel(p).padEnd(grantee) + p.id,
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
