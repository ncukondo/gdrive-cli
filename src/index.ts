#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { z } from "zod";
import type { OutputFormat } from "./types/index.ts";
import { ExitCode, errorToCode, errorToExit } from "./types/index.ts";
import { renderError } from "./lib/output.ts";
import { nodeFs } from "./lib/fs.ts";
import { loadConfig } from "./lib/config.ts";
import { registerCommands } from "./commands/index.ts";
import pkg from "../package.json" with { type: "json" };

const FormatSchema = z.enum(["text", "json"]);

export interface GlobalOptions {
  format: OutputFormat;
  /**
   * True when `-f/--format` named the format on the command line. Everything
   * else — `$GDRIVE_CLI_FORMAT`, `default_format`, the built-in fallback — is a
   * default, which is to say a preference the caller never expressed. Two rules
   * turn on the difference: `--quiet` outranks a default but not a named format
   * (decision 0038), and a command whose output *is* a document keeps printing
   * the document until a format is named (decision 0036 §1).
   */
  formatNamed: boolean;
  quiet: boolean;
  account?: string;
  config?: string;
}

/**
 * The format for a command whose output *is* a document — `docs read`'s
 * Markdown, `forms read`'s YAML. Those already are the machine representation
 * (decision 0036 §1), so the JSON default has nothing to offer them and only a
 * named `-f json` wraps one in the envelope.
 */
export function documentFormat(opts: GlobalOptions): OutputFormat {
  return opts.formatNamed ? opts.format : "text";
}

/**
 * Whether a command may stop and ask the user something.
 *
 * Decision 0005 suppresses `gdrive auth`'s credential prompt in JSON mode "to
 * preserve automation", and the format was only ever a proxy for the question
 * that rule is really asking: *is a human present*. Asking it directly covers
 * what the proxy missed in both directions — a fresh install that named no
 * format still gets prompted, and `GDRIVE_CLI_FORMAT=json`, `default_format`,
 * or any cron job with no terminal gets `AUTH_REQUIRED` and exit 2 instead of a
 * process waiting on a stdin nobody is typing into.
 *
 * A named `-f json` refuses on its own, terminal or not: that caller asked for
 * a machine answer and a prompt is not one.
 */
export function canPrompt(opts: GlobalOptions): boolean {
  if (opts.formatNamed && opts.format === "json") return false;
  return process.stdin.isTTY === true;
}

/**
 * The format for a command whose `--as` names a text encoding — `sheets read`,
 * `forms responses`. Decision 0038's rule generalised from its Consequences: a
 * default applies where the caller expressed no preference, and `--as csv` is a
 * preference said out loud. Nobody types it wanting an envelope, and
 * `sheets read S --as csv > out.csv` writing JSON is the defect 0038 §1
 * describes — a default the flag cannot survive. A named `-f` still wins, as it
 * does over `--quiet`.
 */
export function encodingFormat(opts: GlobalOptions, encodingNamed: boolean): OutputFormat {
  return encodingNamed && !opts.formatNamed ? "text" : opts.format;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("gdrive")
    .description("CLI for Google Drive, Docs, Sheets, and Forms with multi-account switching")
    .version(pkg.version)
    .option("-a, --account <email|alias>", "Account to use (overrides the default)")
    .option("-f, --format <format>", "Output format: text | json", "json")
    .option("-q, --quiet", "Minimal output", false)
    .option("--config <path>", "Config file path");

  // Unknown command: print help and exit 3 (INVALID_ARGS).
  program.on("command:*", (operands) => {
    process.stderr.write(`error: unknown command '${operands[0]}'\n\n`);
    program.outputHelp({ error: true });
    process.exit(ExitCode.ARGUMENT);
  });

  return program;
}

/**
 * Format default when `-f/--format` is absent: `$GDRIVE_CLI_FORMAT`, then
 * `default_format` in the config (decision 0006), then the machine format
 * (decision 0036 §1). A broken config is ignored here — the command's own
 * `loadConfig` reports it as a `CONFIG_ERROR`.
 */
function defaultFormat(configPath?: string): string {
  const fromEnv = process.env["GDRIVE_CLI_FORMAT"];
  if (fromEnv) return fromEnv;
  try {
    return loadConfig(nodeFs, configPath).default_format;
  } catch {
    return "json";
  }
}

export function resolveGlobalOptions(program: Command): GlobalOptions {
  const raw = program.opts<{
    format: string;
    quiet: boolean;
    account?: string;
    config?: string;
  }>();

  const formatNamed = program.getOptionValueSource("format") !== "default";
  const format = formatNamed ? raw.format : defaultFormat(raw.config);

  const formatResult = FormatSchema.safeParse(format);
  if (!formatResult.success) {
    process.stderr.write(`error: invalid format '${format}'. Must be 'text' or 'json'.\n`);
    process.exit(ExitCode.ARGUMENT);
  }

  // `-q` asks for the bare value, and gets it whatever the unnamed default is
  // (decision 0038 §1). A named format still wins, because the caller said it
  // out loud and terseness was only ever implied (§2).
  const resolved = raw.quiet && !formatNamed ? "text" : formatResult.data;

  const opts: GlobalOptions = {
    format: resolved,
    formatNamed,
    quiet: raw.quiet,
  };
  if (raw.account !== undefined) opts.account = raw.account;
  if (raw.config !== undefined) opts.config = raw.config;
  return opts;
}

export function handleError(error: unknown, format: OutputFormat): void {
  const code = errorToCode(error);
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(renderError(code, message, format));
  process.exit(errorToExit(code));
}

export function main(argv: string[] = process.argv): void {
  const program = createProgram();
  registerCommands(program);
  try {
    program.parse(argv);
  } catch (error) {
    handleError(error, resolveGlobalOptions(program).format);
  }
}

/**
 * True when this module is the process entry point.
 *
 * `argv[1]` must be resolved through symlinks first: an npm install links
 * `node_modules/.bin/gdrive` at the real `dist/index.js`, so comparing the raw
 * path would never match and the CLI would exit silently.
 */
export function isEntryPoint(
  moduleUrl: string,
  invokedPath: string | undefined,
  moduleMain?: unknown,
): boolean {
  if (typeof moduleMain === "boolean" && moduleMain) return true;
  if (invokedPath === undefined) return false;
  let resolved = invokedPath;
  try {
    resolved = realpathSync(invokedPath);
  } catch {
    // Not a real path (or unreadable) — fall back to comparing it as given.
  }
  return moduleUrl === pathToFileURL(resolved).href;
}

if (isEntryPoint(import.meta.url, process.argv[1], import.meta.main)) {
  main();
}
