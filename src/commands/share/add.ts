import { Command } from "commander";
import {
  AppError,
  type CommandResult,
  type DrivePermission,
  type OutputFormat,
  type ShareRole,
} from "../../types/index.ts";
import { line, renderSuccess } from "../../lib/output.ts";
import { parseChoice } from "../../lib/args.ts";
import { inferGrantee, type PermissionCreateInput } from "../../lib/api.ts";

const SHARE_ROLES: ShareRole[] = ["reader", "commenter", "writer", "fileOrganizer", "organizer"];

/** Roles an anyone-with-link permission can hold (decision 0018 §2). */
export const LINK_ROLES: ShareRole[] = ["reader", "commenter", "writer"];

function rejectOwner(value: string): void {
  if (value === "owner") {
    throw new AppError("INVALID_ARGS", "Ownership transfer (--role owner) is not supported.");
  }
}

/**
 * Validates `share add --role`, defaulting to `reader`. `owner` is out of
 * scope (0011); `organizer` / `fileOrganizer` are spelled as the API spells
 * them, so `share list` output round-trips (0018).
 */
export function parseShareRole(value: string | undefined): ShareRole {
  if (value === undefined) return "reader";
  rejectOwner(value);
  return parseChoice(SHARE_ROLES, value, "--role");
}

/** Validates `share link --role`: the shared-drive roles are not link roles. */
export function parseLinkRole(value: string | undefined): ShareRole {
  if (value === undefined) return "reader";
  rejectOwner(value);
  return parseChoice(LINK_ROLES, value, "--role");
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
  const role = parseShareRole(deps.role);
  const grantee = inferGrantee({
    ...(deps.to !== undefined ? { to: deps.to } : {}),
    ...(deps.domain !== undefined ? { domain: deps.domain } : {}),
    ...(deps.anyone ? { anyone: true } : {}),
  });

  // Decidable without a round trip, unlike "is this file on a shared drive?",
  // which decision 0018 §3 leaves to Google.
  if (grantee.type === "anyone" && !LINK_ROLES.includes(role)) {
    throw new AppError(
      "INVALID_ARGS",
      `--anyone cannot hold the ${role} role. Use: ${LINK_ROLES.join(", ")}.`,
    );
  }

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
        text: line`Granted ${role} to ${grantTarget(input)} (${permission.id})`,
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
    .option(
      "--role <role>",
      "Role: reader | commenter | writer | fileOrganizer | organizer (default reader; the last two are shared-drive only)",
    )
    .option("--notify", "Send a notification email to the grantee")
    .option("--message <text>", "Message included in the notification email")
    .option("--allow-discovery", "Make the file discoverable in search (domain/anyone)");
}
