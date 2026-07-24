import { google } from "googleapis";
import { AppError } from "../types/index.ts";
import type { Config } from "./config.ts";
import { resolveAccount } from "./config.ts";
import type { FsAdapter } from "./fs.ts";
import { getAuthenticatedClient, listTokenEmails, type FetchFn } from "./auth.ts";

type OAuth2Client = InstanceType<(typeof google.auth)["OAuth2"]>;

/** Emails of all locally authenticated accounts. */
export function listAuthenticatedAccounts(
  fs: Pick<FsAdapter, "existsSync" | "readdirSync">,
): string[] {
  return listTokenEmails(fs);
}

/**
 * Resolves the account to act on, in priority order (decision 0004):
 * `requested` (`-a`) > `$GDRIVE_CLI_ACCOUNT` > `default_account` > the sole
 * authenticated account. Aliases resolve to their canonical email.
 *
 * - A named-but-unauthenticated account → `ACCOUNT_NOT_FOUND`.
 * - No accounts authenticated at all → `AUTH_REQUIRED`.
 * - Multiple accounts and no selection → `ACCOUNT_NOT_FOUND` (ambiguous).
 */
export function resolveAccountEmail(
  fs: Pick<FsAdapter, "existsSync" | "readdirSync">,
  config: Config,
  requested?: string,
): string {
  const accounts = listAuthenticatedAccounts(fs);
  const selection = requested ?? process.env["GDRIVE_CLI_ACCOUNT"] ?? config.default_account;

  if (selection) {
    const email = resolveAccount(config, selection);
    if (!accounts.includes(email)) {
      throw new AppError("ACCOUNT_NOT_FOUND", `Account not authenticated: ${selection}`);
    }
    return email;
  }

  if (accounts.length === 0) {
    throw new AppError("AUTH_REQUIRED", "No authenticated accounts. Run `gdrive auth`.");
  }
  if (accounts.length === 1) {
    return accounts[0] as string;
  }
  throw new AppError(
    "ACCOUNT_NOT_FOUND",
    "Multiple accounts authenticated; specify -a <email|alias> or set default_account.",
  );
}

/** Resolves the account then returns an authenticated OAuth2 client for it. */
export async function getAccountClient(
  fs: FsAdapter,
  config: Config,
  requested?: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<{ email: string; client: OAuth2Client }> {
  const email = resolveAccountEmail(fs, config, requested);
  const client = await getAuthenticatedClient(fs, email, fetchFn);
  return { email, client };
}
