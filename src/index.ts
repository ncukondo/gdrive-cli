#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { z } from "zod";
import type { OutputFormat } from "./types/index.ts";
import { AppError, ExitCode, errorToCode, errorToExit } from "./types/index.ts";
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
 *
 * This covers the prompt and only the prompt. The wait *after* it — the OAuth
 * flow — is {@link noReader}'s, on a different stream, for the reason that
 * function gives.
 */
export function canPrompt(opts: GlobalOptions): boolean {
  if (askedForJson(opts)) return false;
  return process.stdin.isTTY === true;
}

/** A caller who said `-f json` out loud, rather than inheriting it. */
function askedForJson(opts: GlobalOptions): boolean {
  return opts.formatNamed && opts.format === "json";
}

/** Why nobody will read what this command prints for a person (decision 0059). */
export type NoReader =
  /** Nothing is attached to stderr: a cron entry, a CI job, output redirected. */
  | "no_terminal"
  /** A caller who named `-f json` and therefore asked for a machine answer. */
  | "asked_for_json";

/**
 * Whether somebody will see a consent URL, and if not, why not. `undefined`
 * means somebody will.
 *
 * This is `canPrompt`'s question about a different stream, and the difference
 * is the whole of decision 0059. A prompt needs **stdin**, because somebody has
 * to type into it. The OAuth flow needs the URL it prints to be *read*, and
 * 0059 §1 puts that on **stderr** — so this asks about stderr, and asking about
 * stdin instead is the mistake that refuses `gdrive auth </dev/null` at an
 * interactive shell while still hanging on `gdrive auth > log` at that same
 * shell. Two gates because two streams; the failure 0059 answers was one wait
 * with no gate at all, not a second predicate.
 *
 * The reason is returned rather than a boolean because only one of the two is
 * fixed by dropping a flag. The terminal is checked first for that reason: on a
 * machine with none, "re-run without `-f json`" is advice that does not work.
 */
export function noReader(opts: GlobalOptions): NoReader | undefined {
  if (process.stderr.isTTY !== true) return "no_terminal";
  if (askedForJson(opts)) return "asked_for_json";
  return undefined;
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

/**
 * `quiet` is **required**, and that is the whole of what this parameter has to
 * teach. It used to default to `false` on the reasoning that only a command
 * reporting a partial result (decision 0031 §4) had anything to vary with it —
 * so every other registrar could leave it out. The defaulting is what made the
 * distinction invisible: a command that *later* grows an error payload with
 * values in it keeps compiling, keeps passing its unit tests, and silently
 * prints nothing for `-q`. Five of forty-four call sites passed it, and
 * `forms write` and `slides write` were two of the thirty-nine that did not on
 * the day their refusal gained a payload (issue #31).
 *
 * A required parameter moves that from something a reviewer has to notice to
 * something `tsc` decides, which is decision 0047 §1 one layer down.
 *
 * The reason goes to stderr and the values `-q` asked for go to stdout, which
 * is the only stream `$(…)` and a pipe read — {@link renderError} decides the
 * split and says why.
 */
export function handleError(error: unknown, format: OutputFormat, quiet: boolean): void {
  const code = errorToCode(error);
  const message = error instanceof Error ? error.message : String(error);
  const data = error instanceof AppError ? error.data : undefined;
  const rendered = renderError(code, message, format, quiet, data);
  process.stderr.write(rendered.stderr);
  if (rendered.stdout !== "") process.stdout.write(rendered.stdout);
  process.exit(errorToExit(code));
}

export function main(argv: string[] = process.argv): void {
  const program = createProgram();
  registerCommands(program);
  try {
    program.parse(argv);
  } catch (error) {
    const opts = resolveGlobalOptions(program);
    handleError(error, opts.format, opts.quiet);
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
