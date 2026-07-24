#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { z } from "zod";
import type { OutputFormat } from "./types/index.ts";
import { ExitCode, errorToCode, errorToExit } from "./types/index.ts";
import { renderError } from "./lib/output.ts";
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

export function resolveGlobalOptions(program: Command): GlobalOptions {
  const raw = program.opts<{
    format: string;
    quiet: boolean;
    account?: string;
    config?: string;
  }>();

  const formatResult = FormatSchema.safeParse(raw.format);
  if (!formatResult.success) {
    process.stderr.write(`error: invalid format '${raw.format}'. Must be 'text' or 'json'.\n`);
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

const invokedPath = process.argv[1];
const isMain =
  (typeof import.meta.main === "boolean" && import.meta.main) ||
  (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href);

if (isMain) {
  main();
}
