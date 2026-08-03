import type { Command } from "commander";
import { AppError, type CommandResult, type OutputFormat } from "../types/index.ts";
import { renderSuccess } from "../lib/output.ts";
import { nodeFs, type FsAdapter } from "../lib/fs.ts";
import { getDefaultConfigPath, saveConfig, type Config } from "../lib/config.ts";
import { listTokenEmails } from "../lib/auth.ts";
import { resolveGlobalOptions, handleError } from "../index.ts";

export interface InitPathArgs {
  configPath?: string;
  local?: boolean;
}

/** `--config` > `--local` (`./gdrive-cli.toml`) > the default path (0006). */
export function resolveInitPath(args: InitPathArgs): string {
  if (args.configPath) return args.configPath;
  if (args.local) return `${process.cwd()}/gdrive-cli.toml`;
  return getDefaultConfigPath();
}

export interface InitDeps {
  fs: FsAdapter;
  /** Emails with a token file under `accounts/` (decision 0004). */
  listAccounts: () => string[];
  path: string;
  force?: boolean;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

function formatInitText(path: string, accounts: string[], defaultAccount?: string): string {
  const lines = [`Created ${path}`];
  if (accounts.length === 0) {
    lines.push("No authenticated accounts yet. Run `gdrive auth`.");
  } else {
    lines.push(`Accounts: ${accounts.join(", ")}`);
    if (defaultAccount) lines.push(`Default:  ${defaultAccount}`);
  }
  return lines.join("\n");
}

export async function handleInit(deps: InitDeps): Promise<CommandResult> {
  if (deps.fs.existsSync(deps.path) && !deps.force) {
    throw new AppError(
      "CONFIG_ERROR",
      `Config already exists: ${deps.path}. Use --force to overwrite.`,
    );
  }

  const accounts = deps.listAccounts();
  const config: Config = {
    // The same default the CLI applies without a config, written down rather
    // than inverted: a generated file must not quietly restore the old one
    // (decision 0036 §1).
    default_format: "json",
    accounts: accounts.map((email) => ({ email })),
  };
  const defaultAccount = accounts[0];
  if (defaultAccount !== undefined) config.default_account = defaultAccount;

  saveConfig(deps.fs, deps.path, config);

  deps.write(
    renderSuccess(
      {
        data: {
          path: deps.path,
          accounts,
          default_account: defaultAccount ?? null,
          created: true,
        },
        text: formatInitText(deps.path, accounts, defaultAccount),
        quiet: deps.path,
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function registerInit(program: Command): void {
  const init = program
    .command("init")
    .description("Generate a config file, seeded from authenticated accounts")
    .option("--local", "Write ./gdrive-cli.toml instead of the default location")
    .option("--force", "Overwrite an existing config file");

  init.action(async () => {
    const opts = resolveGlobalOptions(program);
    const o = init.opts<{ local?: boolean; force?: boolean }>();
    try {
      const result = await handleInit({
        fs: nodeFs,
        listAccounts: () => listTokenEmails(nodeFs),
        path: resolveInitPath({
          ...(opts.config !== undefined ? { configPath: opts.config } : {}),
          ...(o.local ? { local: true } : {}),
        }),
        format: opts.format,
        quiet: opts.quiet,
        write: (m) => process.stdout.write(m + "\n"),
        ...(o.force ? { force: true } : {}),
      });
      process.exit(result.exitCode);
    } catch (error) {
      handleError(error, opts.format);
    }
  });
}
