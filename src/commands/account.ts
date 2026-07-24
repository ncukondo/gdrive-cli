import type { Command } from "commander";
import { AppError, type CommandResult, type OutputFormat } from "../types/index.ts";
import { renderSuccess } from "../lib/output.ts";
import { nodeFs, type FsAdapter } from "../lib/fs.ts";
import {
  aliasForEmail,
  findConfigPath,
  getDefaultConfigPath,
  loadConfig,
  resolveAccount,
  saveConfig,
  setAlias,
  setDefaultAccount,
  type Config,
} from "../lib/config.ts";
import { listTokenEmails, revokeTokens, type FetchFn } from "../lib/auth.ts";
import { resolveGlobalOptions, handleError } from "../index.ts";

export interface AccountView {
  email: string;
  alias: string | null;
  default: boolean;
  authenticated: boolean;
}

function isDefaultAccount(config: Config, email: string): boolean {
  return (
    config.default_account !== undefined && resolveAccount(config, config.default_account) === email
  );
}

/** Reconciles authenticated token files with `[[accounts]]` config entries. */
export function buildAccountViews(config: Config, authenticatedEmails: string[]): AccountView[] {
  const emails = new Set<string>(authenticatedEmails);
  for (const a of config.accounts) emails.add(a.email);

  const views: AccountView[] = [...emails].map((email) => ({
    email,
    alias: aliasForEmail(config, email) ?? null,
    default: isDefaultAccount(config, email),
    authenticated: authenticatedEmails.includes(email),
  }));

  // Default first, then authenticated, then by email.
  return views.sort((a, b) => {
    if (a.default !== b.default) return a.default ? -1 : 1;
    if (a.authenticated !== b.authenticated) return a.authenticated ? -1 : 1;
    return a.email.localeCompare(b.email);
  });
}

function formatAccountList(views: AccountView[]): string {
  if (views.length === 0) return "No accounts. Run `gdrive auth`.";
  const lines = views.map((v) => {
    const marker = v.default ? "*" : " ";
    const alias = v.alias ? ` (${v.alias})` : "";
    const unauth = v.authenticated ? "" : " (not authenticated)";
    return `${marker} ${v.email}${alias}${unauth}`;
  });
  return lines.join("\n");
}

// --- list -------------------------------------------------------------------

export interface AccountListDeps {
  fs: FsAdapter;
  config: Config;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleAccountList(deps: AccountListDeps): Promise<CommandResult> {
  const authenticated = listTokenEmails(deps.fs);
  const views = buildAccountViews(deps.config, authenticated);
  const quietText = views
    .filter((v) => v.authenticated)
    .map((v) => v.email)
    .join("\n");

  deps.write(
    renderSuccess(
      {
        data: { accounts: views, default_account: deps.config.default_account ?? null },
        text: formatAccountList(views),
        quiet: quietText,
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

// --- use --------------------------------------------------------------------

export interface AccountMutateDeps {
  fs: FsAdapter;
  config: Config;
  ref: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
  writeConfig: (config: Config) => void;
}

export async function handleAccountUse(deps: AccountMutateDeps): Promise<CommandResult> {
  const email = resolveAccount(deps.config, deps.ref);
  if (!listTokenEmails(deps.fs).includes(email)) {
    throw new AppError("ACCOUNT_NOT_FOUND", `Account not authenticated: ${deps.ref}`);
  }
  deps.writeConfig(setDefaultAccount(deps.config, email));

  deps.write(
    renderSuccess(
      { data: { default_account: email }, text: `Default account set to ${email}`, quiet: email },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

// --- alias ------------------------------------------------------------------

export interface AccountAliasDeps extends AccountMutateDeps {
  alias: string;
}

export async function handleAccountAlias(deps: AccountAliasDeps): Promise<CommandResult> {
  const email = resolveAccount(deps.config, deps.ref);
  const known =
    listTokenEmails(deps.fs).includes(email) || deps.config.accounts.some((a) => a.email === email);
  if (!known) {
    throw new AppError("ACCOUNT_NOT_FOUND", `Account not found: ${deps.ref}`);
  }
  const collision = deps.config.accounts.find((a) => a.alias === deps.alias && a.email !== email);
  if (collision) {
    throw new AppError(
      "INVALID_ARGS",
      `Alias "${deps.alias}" is already used by ${collision.email}.`,
    );
  }
  deps.writeConfig(setAlias(deps.config, email, deps.alias));

  deps.write(
    renderSuccess(
      {
        data: { email, alias: deps.alias },
        text: `Alias "${deps.alias}" -> ${email}`,
        quiet: email,
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

// --- remove -----------------------------------------------------------------

export interface AccountRemoveDeps extends AccountMutateDeps {
  revoke: (email: string) => Promise<void>;
}

export async function handleAccountRemove(deps: AccountRemoveDeps): Promise<CommandResult> {
  const email = resolveAccount(deps.config, deps.ref);
  const known =
    listTokenEmails(deps.fs).includes(email) || deps.config.accounts.some((a) => a.email === email);
  if (!known) {
    throw new AppError("ACCOUNT_NOT_FOUND", `Account not found: ${deps.ref}`);
  }

  await deps.revoke(email);

  const accounts = deps.config.accounts.filter((a) => a.email !== email);
  const next: Config = { ...deps.config, accounts };
  if (isDefaultAccount(deps.config, email)) delete next.default_account;
  deps.writeConfig(next);

  deps.write(
    renderSuccess(
      { data: { email, removed: true }, text: `Removed ${email}`, quiet: email },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

// --- registration -----------------------------------------------------------

function resolveConfigWritePath(fs: FsAdapter, cliPath?: string): string {
  return findConfigPath(fs, cliPath) ?? getDefaultConfigPath();
}

export function registerAccount(program: Command): void {
  const account = program
    .command("account")
    .description("Manage authenticated accounts and aliases");

  account
    .command("list")
    .description("List accounts, aliases, and the default")
    .action(async () => {
      const opts = resolveGlobalOptions(program);
      try {
        const config = loadConfig(nodeFs, opts.config);
        const result = await handleAccountList({
          fs: nodeFs,
          config,
          format: opts.format,
          quiet: opts.quiet,
          write: (m) => process.stdout.write(m + "\n"),
        });
        process.exit(result.exitCode);
      } catch (error) {
        handleError(error, opts.format);
      }
    });

  account
    .command("use <account>")
    .description("Set the default account")
    .action(async (ref: string) => {
      const opts = resolveGlobalOptions(program);
      try {
        const config = loadConfig(nodeFs, opts.config);
        const writePath = resolveConfigWritePath(nodeFs, opts.config);
        const result = await handleAccountUse({
          fs: nodeFs,
          config,
          ref,
          format: opts.format,
          quiet: opts.quiet,
          write: (m) => process.stdout.write(m + "\n"),
          writeConfig: (c) => saveConfig(nodeFs, writePath, c),
        });
        process.exit(result.exitCode);
      } catch (error) {
        handleError(error, opts.format);
      }
    });

  account
    .command("alias <account> <alias>")
    .description("Assign or rename an alias")
    .action(async (ref: string, alias: string) => {
      const opts = resolveGlobalOptions(program);
      try {
        const config = loadConfig(nodeFs, opts.config);
        const writePath = resolveConfigWritePath(nodeFs, opts.config);
        const result = await handleAccountAlias({
          fs: nodeFs,
          config,
          ref,
          alias,
          format: opts.format,
          quiet: opts.quiet,
          write: (m) => process.stdout.write(m + "\n"),
          writeConfig: (c) => saveConfig(nodeFs, writePath, c),
        });
        process.exit(result.exitCode);
      } catch (error) {
        handleError(error, opts.format);
      }
    });

  account
    .command("remove <account>")
    .description("Remove an account (revoke token + drop alias)")
    .action(async (ref: string) => {
      const opts = resolveGlobalOptions(program);
      const fetchFn: FetchFn = globalThis.fetch;
      try {
        const config = loadConfig(nodeFs, opts.config);
        const writePath = resolveConfigWritePath(nodeFs, opts.config);
        const result = await handleAccountRemove({
          fs: nodeFs,
          config,
          ref,
          format: opts.format,
          quiet: opts.quiet,
          write: (m) => process.stdout.write(m + "\n"),
          writeConfig: (c) => saveConfig(nodeFs, writePath, c),
          revoke: (email) => revokeTokens(nodeFs, email, fetchFn),
        });
        process.exit(result.exitCode);
      } catch (error) {
        handleError(error, opts.format);
      }
    });
}
