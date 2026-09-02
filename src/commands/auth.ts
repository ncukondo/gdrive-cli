import type { Command } from "commander";
import { AppError, type CommandResult, type OutputFormat } from "../types/index.ts";
import { formatValues, line, renderSuccess } from "../lib/output.ts";
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
import { canPrompt, noReader, type NoReader, resolveGlobalOptions, handleError } from "../index.ts";

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
        quiet: formatValues([email]),
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
      {
        data: { email, logged_out: true },
        text: line`Logged out ${email}`,
        quiet: formatValues([email]),
      },
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
   * Whether there is a human at a terminal to ask for OAuth client credentials.
   * False with no tty on stdin, and false when the caller named `-f json` — see
   * `canPrompt` in `src/index.ts`, which is where the rule lives.
   */
  canPrompt: boolean;
  /**
   * Why nobody will read the consent URL, or `undefined` when somebody will.
   * A different question from `canPrompt`, on a different stream — see
   * `noReader` in `src/index.ts` and decision 0059 §2.
   */
  noReader: NoReader | undefined;
  quiet: boolean;
  /** stdout: the envelope, and nothing else (decision 0059 §1). */
  write: (msg: string) => void;
  /** stderr: the consent URL, and every notice on the way to it. */
  warn: (msg: string) => void;
  promptFn: PromptFn;
  /** Runs the browser flow for `credentials`, returning the persisted token. */
  runFlow: (credentials: ClientCredentials) => Promise<TokenData>;
  /** Persists the config when the first account becomes the default. */
  writeConfig: (config: Config) => void;
}

/**
 * What to tell somebody whose login was refused before it started
 * (decision 0059 §5). Not "cannot authenticate": one of these two is fixed by
 * dropping a flag and the other is not, and a message that names both leaves
 * the caller to work out which applies.
 */
function refusal(reason: NoReader): AppError {
  const why =
    reason === "no_terminal"
      ? "`gdrive auth` needs a terminal. It prints a consent URL for you to open and then waits for your browser to come back, and nothing is attached to read that URL. Log in where you have one; the token lands in ~/.config/gdrive-cli/accounts/<email>.json, and a machine you copy it to needs client_secret.json (or GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET) as well."
      : "Logging in means a person opening a URL, which a caller that named `-f json` is not. Re-run without it.";
  return new AppError("AUTH_REQUIRED", why);
}

export async function handleAuthLogin(deps: AuthLoginDeps): Promise<CommandResult> {
  // Both of this command's waits are refused before either one starts, and
  // before a port is opened (decision 0059 §2). `canPrompt` used to guard only
  // the first; `runFlow` below blocks on a loopback server until a browser
  // redirects back, and had no gate at all — so a machine that already had
  // client_secret.json got past the gate and hung on the wait that has none.
  // That was issue #17.
  if (deps.noReader !== undefined) throw refusal(deps.noReader);

  // Decision 0005 keeps this from prompting where nothing can answer, so a
  // script gets AUTH_REQUIRED rather than a process waiting on stdin. The
  // notice goes to `warn`, because it is addressed to a person and stdout
  // belongs to the envelope (0059 §1).
  const credentials = deps.canPrompt
    ? await getClientCredentialsOrPrompt(deps.fs, deps.warn, deps.promptFn)
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
        quiet: formatValues([tokens.email]),
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
      const warn = (msg: string) => process.stderr.write(msg + "\n");
      try {
        const config = loadConfig(nodeFs, opts.config);
        const writePath = resolveConfigWritePath(nodeFs, opts.config);
        const result = await handleAuthLogin({
          fs: nodeFs,
          config,
          format: opts.format,
          canPrompt: canPrompt(opts),
          noReader: noReader(opts),
          quiet: opts.quiet,
          write,
          warn,
          promptFn: createReadlinePrompt(),
          runFlow: async (credentials) => {
            const { authUrl, waitForToken, server } = await startOAuthFlow(credentials, nodeFs);
            warn(`Open this URL in your browser:\n${authUrl}`);
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
        handleError(error, opts.format, opts.quiet);
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
        handleError(error, opts.format, opts.quiet);
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
        handleError(error, opts.format, opts.quiet);
      }
    });
}
