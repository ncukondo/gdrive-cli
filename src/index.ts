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
  quiet: boolean;
  account?: string;
  config?: string;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("gdrive")
    .description("CLI for Google Drive, Docs, and Sheets with multi-account switching")
    .version(pkg.version)
    .option("-a, --account <email|alias>", "Account to use (overrides the default)")
    .option("-f, --format <format>", "Output format: text | json", "text")
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
 * `default_format` in the config (decision 0006). A broken config is ignored
 * here — the command's own `loadConfig` reports it as a `CONFIG_ERROR`.
 */
function defaultFormat(configPath?: string): string {
  const fromEnv = process.env["GDRIVE_CLI_FORMAT"];
  if (fromEnv) return fromEnv;
  try {
    return loadConfig(nodeFs, configPath).default_format;
  } catch {
    return "text";
  }
}

export function resolveGlobalOptions(program: Command): GlobalOptions {
  const raw = program.opts<{
    format: string;
    quiet: boolean;
    account?: string;
    config?: string;
  }>();

  const explicitFormat = program.getOptionValueSource("format") !== "default";
  const format = explicitFormat ? raw.format : defaultFormat(raw.config);

  const formatResult = FormatSchema.safeParse(format);
  if (!formatResult.success) {
    process.stderr.write(`error: invalid format '${format}'. Must be 'text' or 'json'.\n`);
    process.exit(ExitCode.ARGUMENT);
  }

  const opts: GlobalOptions = {
    format: formatResult.data,
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
