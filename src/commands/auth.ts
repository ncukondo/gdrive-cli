import type { Command } from "commander";
import { AppError, type CommandResult, type OutputFormat } from "../types/index.ts";
import { line, renderSuccess } from "../lib/output.ts";
import { nodeFs, type FsAdapter } from "../lib/fs.ts";
import {
  aliasForEmail,
  findConfigPath,
  getDefaultConfigPath,
  loadConfig,
  resolveAccount,
  saveConfig,
  setDefaultAccount,
  type Config,
} from "../lib/config.ts";
import {
  getClientCredentials,
  getClientCredentialsOrPrompt,
  loadTokens,
  revokeTokens,
  startOAuthFlow,
  type ClientCredentials,
  type FetchFn,
  type PromptFn,
  type TokenData,
} from "../lib/auth.ts";
import { listAuthenticatedAccounts, resolveAccountEmail } from "../lib/account.ts";
import { createReadlinePrompt } from "../lib/prompt.ts";
import { canPrompt, resolveGlobalOptions, handleError } from "../index.ts";

/** Maps a full scope URL to a short label (…/auth/drive → "drive"). */
function shortScope(scope: string): string {
  const slash = scope.lastIndexOf("/");
  return slash >= 0 ? scope.slice(slash + 1) : scope;
}

function isDefaultAccount(config: Config, email: string): boolean {
  return (
    config.default_account !== undefined && resolveAccount(config, config.default_account) === email
  );
}

// --- status ----------------------------------------------------------------

export interface AuthStatusDeps {
  fs: FsAdapter;
  config: Config;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
  account?: string;
}

export async function handleAuthStatus(deps: AuthStatusDeps): Promise<CommandResult> {
  const email = resolveAccountEmail(deps.fs, deps.config, deps.account);
  const tokens = loadTokens(deps.fs, email);
  if (!tokens) {
    throw new AppError("AUTH_REQUIRED", `No stored token for ${email}. Run \`gdrive auth\`.`);
  }

  const alias = aliasForEmail(deps.config, email);
  const isDefault = isDefaultAccount(deps.config, email);
  const expiresAt = new Date(tokens.expiry_date).toISOString();
  const scopes = tokens.scopes.map(shortScope);

  const textLines = [
    line`Account: ${email}${alias ? ` (alias: ${alias})` : ""}${isDefault ? " [default]" : ""}`,
    line`Token expires: ${expiresAt}`,
    line`Scopes: ${scopes.join(", ")}`,
  ];

  deps.write(
    renderSuccess(
      {
        data: {
          authenticated: true,
          email,
          alias: alias ?? null,
          default: isDefault,
          expires_at: expiresAt,
          scopes,
        },
        text: textLines.join("\n"),
        quiet: email,
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

// --- logout -----------------------------------------------------------------

export interface AuthLogoutDeps {
  fs: FsAdapter;
  config: Config;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
  fetchFn: FetchFn;
  account?: string;
  /** Persists the config after removing the account's alias/default. */
  writeConfig: (config: Config) => void;
}

export async function handleAuthLogout(deps: AuthLogoutDeps): Promise<CommandResult> {
  const email = resolveAccountEmail(deps.fs, deps.config, deps.account);
  await revokeTokens(deps.fs, email, deps.fetchFn);

  // Clean the alias entry and unset default_account if it pointed here.
  const accounts = deps.config.accounts.filter((a) => a.email !== email);
  const next: Config = { ...deps.config, accounts };
  if (deps.config.default_account !== undefined && isDefaultAccount(deps.config, email)) {
    delete next.default_account;
  }
  deps.writeConfig(next);

  deps.write(
    renderSuccess(
      { data: { email, logged_out: true }, text: line`Logged out ${email}`, quiet: email },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

// --- login ------------------------------------------------------------------

export interface AuthLoginDeps {
  fs: FsAdapter;
  config: Config;
  format: OutputFormat;
  /**
   * Whether the caller left room to be asked for OAuth client credentials.
   * False only when they named `-f json` — see `canPrompt` in `src/index.ts`.
   */
  canPrompt: boolean;
  quiet: boolean;
  write: (msg: string) => void;
  promptFn: PromptFn;
  /** Runs the browser flow for `credentials`, returning the persisted token. */
  runFlow: (credentials: ClientCredentials) => Promise<TokenData>;
  /** Persists the config when the first account becomes the default. */
  writeConfig: (config: Config) => void;
}

export async function handleAuthLogin(deps: AuthLoginDeps): Promise<CommandResult> {
  // A caller who asked for JSON asked not to be prompted, and gets
  // AUTH_REQUIRED instead (decision 0005). A JSON *default* nobody named is not
  // that caller: suppressing the prompt for them leaves a fresh install with no
  // way in, which is the defect decision 0038 names one command over.
  const credentials = deps.canPrompt
    ? await getClientCredentialsOrPrompt(deps.fs, deps.write, deps.promptFn)
    : getClientCredentials(deps.fs);

  const isFirstAccount = listAuthenticatedAccounts(deps.fs).length === 0;
  const tokens = await deps.runFlow(credentials);

  if (isFirstAccount) {
    deps.writeConfig(setDefaultAccount(deps.config, tokens.email));
  }

  deps.write(
    renderSuccess(
      {
        data: { authenticated: true, email: tokens.email, default: isFirstAccount },
        text: line`Authenticated as ${tokens.email}${isFirstAccount ? " (set as default account)" : ""}`,
        quiet: tokens.email,
      },
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

export function registerAuth(program: Command): void {
  const auth = program.command("auth").description("Authenticate and manage the active account");

  auth
    .command("login", { isDefault: true })
    .description("Log in via OAuth and store the account token")
    .action(async () => {
      const opts = resolveGlobalOptions(program);
      const write = (msg: string) => process.stdout.write(msg + "\n");
      try {
        const config = loadConfig(nodeFs, opts.config);
        const writePath = resolveConfigWritePath(nodeFs, opts.config);
        const result = await handleAuthLogin({
          fs: nodeFs,
          config,
          format: opts.format,
          canPrompt: canPrompt(opts),
          quiet: opts.quiet,
          write,
          promptFn: createReadlinePrompt(),
          runFlow: async (credentials) => {
            const { authUrl, waitForToken, server } = await startOAuthFlow(credentials, nodeFs);
            write(`Open this URL in your browser:\n${authUrl}`);
            try {
              return await waitForToken;
            } finally {
              server.close();
            }
          },
          writeConfig: (c) => saveConfig(nodeFs, writePath, c),
        });
        process.exit(result.exitCode);
      } catch (error) {
        handleError(error, opts.format);
      }
    });

  auth
    .command("status")
    .description("Show the resolved account's auth state")
    .action(async () => {
      const opts = resolveGlobalOptions(program);
      try {
        const config = loadConfig(nodeFs, opts.config);
        const result = await handleAuthStatus({
          fs: nodeFs,
          config,
          format: opts.format,
          quiet: opts.quiet,
          write: (msg) => process.stdout.write(msg + "\n"),
          ...(opts.account !== undefined ? { account: opts.account } : {}),
        });
        process.exit(result.exitCode);
      } catch (error) {
        handleError(error, opts.format);
      }
    });

  auth
    .command("logout [account]")
    .description("Revoke and remove an account's token")
    .action(async (account?: string) => {
      const opts = resolveGlobalOptions(program);
      const requested = account ?? opts.account;
      try {
        const config = loadConfig(nodeFs, opts.config);
        const writePath = resolveConfigWritePath(nodeFs, opts.config);
        const result = await handleAuthLogout({
          fs: nodeFs,
          config,
          format: opts.format,
          quiet: opts.quiet,
          write: (msg) => process.stdout.write(msg + "\n"),
          fetchFn: globalThis.fetch,
          writeConfig: (c) => saveConfig(nodeFs, writePath, c),
          ...(requested !== undefined ? { account: requested } : {}),
        });
        process.exit(result.exitCode);
      } catch (error) {
        handleError(error, opts.format);
      }
    });
}
