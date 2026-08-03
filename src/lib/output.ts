import type { ErrorCode, OutputFormat } from "../types/index.ts";

/** Serializes a success envelope (decision 0007). */
export function formatJsonSuccess(data: unknown): string {
  return JSON.stringify({ success: true, data }, null, 2);
}

/** Serializes an error envelope (decision 0007). */
export function formatJsonError(code: ErrorCode, message: string): string {
  return JSON.stringify({ success: false, error: { code, message } }, null, 2);
}

/**
 * Anything that would end a field or a line: the C0 and C1 control characters
 * (`\t`, `\n` and `\r` among them) plus the two Unicode line breaks a reader
 * may treat as newlines.
 */
const FIELD_BREAKING = /[\p{Cc}\u2028\u2029]/gu;

/**
 * Text mode is line-oriented, so a value cannot be allowed to invent a field or
 * a row that no record ever had — Drive accepts a newline in a file name, and
 * one there used to split a row in half. The real value is still exact in
 * `-f json`; text is lossy on purpose (decision 0036 §2).
 */
function textField(value: string): string {
  return value.replace(FIELD_BREAKING, " ");
}

/**
 * One row of text output: a single tab between fields, and nothing else
 * (decision 0036 §2). Nothing is padded, so no display width is computed and no
 * display width can be wrong — the whole class of defect the aligned tables had
 * is unreachable rather than fixed. What `split("\t")` gives a reader back is
 * exactly what the renderer put in.
 */
export function formatRow(fields: string[]): string {
  return fields.map(textField).join("\t");
}

/**
 * A header row followed by one row per record. Every text table in the CLI is
 * this shape, so a column that grows in one row leaves every other row alone.
 */
export function formatTable(header: string[], rows: string[][]): string {
  return [formatRow(header), ...rows.map(formatRow)].join("\n");
}

/**
 * A text message with values interpolated into it — `Created folder ${name}
 * (${id})` and its kin. Every interpolated value is sanitised while the literal
 * parts are left alone, so a message that wants a newline keeps it and a name
 * Drive chose cannot add one. A table is not the only place a value can forge a
 * row (decision 0036 §2).
 */
export function line(strings: TemplateStringsArray, ...values: string[]): string {
  return strings.reduce(
    (out, part, i) => out + part + (i < values.length ? textField(values[i] ?? "") : ""),
    "",
  );
}

/**
 * A command result ready for rendering in any output mode. Command-specific
 * text lives with each command; this only routes between modes.
 */
export interface Renderable {
  /** Payload for JSON mode (the stable `data` field). */
  data: unknown;
  /** Human-readable text (default mode). */
  text: string;
  /** Minimal text for `--quiet`; falls back to {@link Renderable.text}. */
  quiet?: string;
}

/**
 * Renders a successful result. JSON mode emits the envelope and **ignores
 * `--quiet`** (decision 0007); text mode uses the quiet variant when `quiet`.
 */
export function renderSuccess(r: Renderable, format: OutputFormat, quiet: boolean): string {
  if (format === "json") {
    return formatJsonSuccess(r.data);
  }
  if (quiet) {
    return r.quiet ?? r.text;
  }
  return r.text;
}

/**
 * The one channel for "this ran, and here is what it could not hold"
 * (decision 0021 §3): a single line on stderr in text mode, so stdout stays a
 * document or a table the caller can pipe, and an `unsupported` field in JSON
 * so nobody has to parse prose.
 *
 * The notes keep each command's own shape — a Markdown write counts lines, a
 * form counts items — so `describe` is what a caller supplies, and the routing
 * rule is what it does not get to vary.
 */
export function reportUnsupported<T>(
  notes: T[],
  options: {
    format: OutputFormat;
    warn: (message: string) => void;
    /** Leads the stderr line, e.g. `Kept as plain text`. */
    prefix: string;
    describe: (note: T) => string;
  },
): { unsupported: T[] } | Record<string, never> {
  if (notes.length === 0) return {};
  if (options.format === "text") {
    options.warn(`${options.prefix}: ${notes.map(options.describe).join(", ")}`);
  }
  return { unsupported: notes };
}

/** Renders an error for stderr in the active format (decision 0007). */
export function renderError(code: ErrorCode, message: string, format: OutputFormat): string {
  if (format === "json") {
    return formatJsonError(code, message);
  }
  return `Error: ${message}\n`;
}
