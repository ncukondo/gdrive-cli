import { Command } from "commander";
import {
  AppError,
  type CommandResult,
  type DrivePermission,
  type OutputFormat,
  type ShareRole,
} from "../../types/index.ts";
import { renderSuccess } from "../../lib/output.ts";
import { parseChoice } from "../../lib/args.ts";
import { inferGrantee, type PermissionCreateInput } from "../../lib/api.ts";

const VALID_ROLES: ShareRole[] = ["reader", "commenter", "writer"];

/** Validates `--role`, defaulting to `reader`. `owner` is out of scope (0011). */
export function parseRole(value: string | undefined): ShareRole {
  if (value === undefined) return "reader";
  if (value === "owner") {
    throw new AppError("INVALID_ARGS", "Ownership transfer (--role owner) is not supported.");
  }
  return parseChoice(VALID_ROLES, value, "--role");
}

export interface ShareAddDeps {
  resolvePath: (arg: string) => Promise<string>;
  createPermission: (fileId: string, input: PermissionCreateInput) => Promise<DrivePermission>;
  file: string;
  to?: string;
  domain?: string;
  anyone?: boolean;
  role?: string;
  notify?: boolean;
  message?: string;
  allowDiscovery?: boolean;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

function grantTarget(input: PermissionCreateInput): string {
  return input.emailAddress ?? input.domain ?? "anyone with the link";
}

export async function handleShareAdd(deps: ShareAddDeps): Promise<CommandResult> {
  const role = parseRole(deps.role);
  const grantee = inferGrantee({
    ...(deps.to !== undefined ? { to: deps.to } : {}),
    ...(deps.domain !== undefined ? { domain: deps.domain } : {}),
    ...(deps.anyone ? { anyone: true } : {}),
  });

  const input: PermissionCreateInput = { type: grantee.type, role };
  if (grantee.emailAddress !== undefined) input.emailAddress = grantee.emailAddress;
  if (grantee.domain !== undefined) input.domain = grantee.domain;
  if (deps.allowDiscovery) input.allowFileDiscovery = true;
  if (deps.notify) input.sendNotificationEmail = true;
  if (deps.message !== undefined) input.emailMessage = deps.message;

  const fileId = await deps.resolvePath(deps.file);
  const permission = await deps.createPermission(fileId, input);

  deps.write(
    renderSuccess(
      {
        data: { id: fileId, permission },
        text: `Granted ${role} to ${grantTarget(input)} (${permission.id})`,
        quiet: permission.id,
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createShareAddCommand(): Command {
  return new Command("add")
    .description("Grant access to a file")
    .argument("<file>", "File ID or path")
    .option("--to <email>", "Grant to a user or group email address")
    .option("--domain <domain>", "Grant to everyone in a domain")
    .option("--anyone", "Grant to anyone with the link")
    .option("--role <role>", "Role: reader | commenter | writer (default reader)")
    .option("--notify", "Send a notification email to the grantee")
    .option("--message <text>", "Message included in the notification email")
    .option("--allow-discovery", "Make the file discoverable in search (domain/anyone)");
}
