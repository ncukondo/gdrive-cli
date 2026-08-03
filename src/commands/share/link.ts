import { Command } from "commander";
import type {
  CommandResult,
  DriveFile,
  DrivePermission,
  OutputFormat,
  ShareRole,
} from "../../types/index.ts";
import { formatValues, line, renderSuccess } from "../../lib/output.ts";
import type { PermissionCreateInput } from "../../lib/api.ts";
import { parseLinkRole } from "./add.ts";

export interface ShareLinkDeps {
  resolvePath: (arg: string) => Promise<string>;
  getFile: (fileId: string) => Promise<DriveFile>;
  listPermissions: (fileId: string) => Promise<DrivePermission[]>;
  createPermission: (fileId: string, input: PermissionCreateInput) => Promise<DrivePermission>;
  updatePermissionRole: (
    fileId: string,
    permissionId: string,
    role: ShareRole,
  ) => Promise<DrivePermission>;
  file: string;
  role?: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

/** Falls back to a generic Drive URL when the file exposes no webViewLink. */
function shareableUrl(file: DriveFile): string {
  return file.web_view_link ?? `https://drive.google.com/open?id=${file.id}`;
}

export async function handleShareLink(deps: ShareLinkDeps): Promise<CommandResult> {
  const role = parseLinkRole(deps.role);
  const fileId = await deps.resolvePath(deps.file);

  const existing = (await deps.listPermissions(fileId)).find((p) => p.type === "anyone");
  let permission: DrivePermission;
  if (!existing) {
    permission = await deps.createPermission(fileId, { type: "anyone", role });
  } else if (existing.role !== role) {
    permission = await deps.updatePermissionRole(fileId, existing.id, role);
  } else {
    permission = existing;
  }

  const file = await deps.getFile(fileId);
  const url = shareableUrl(file);

  deps.write(
    renderSuccess(
      {
        data: { id: fileId, web_view_link: url, permission },
        text: line`Anyone with the link (${permission.role})\n${url}`,
        quiet: formatValues([url]),
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createShareLinkCommand(): Command {
  return new Command("link")
    .description("Ensure an anyone-with-link permission and print the shareable URL")
    .argument("<file>", "File ID or path")
    .option("--role <role>", "Role: reader | commenter | writer (default reader)");
}
