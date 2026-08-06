import type { ErrorCode, ErrorData, OutputFormat } from "../types/index.ts";

/** Serializes a success envelope (decision 0007). */
export function formatJsonSuccess(data: unknown): string {
  return JSON.stringify({ success: true, data }, null, 2);
}

/**
 * Serializes an error envelope (decision 0007), with the optional `data` of
 * decision 0031 §4 when the failure has one.
 *
 * The key is spread in rather than set to `undefined`, because
 * `JSON.stringify` would drop an `undefined` value anyway and a reader of this
 * function should not have to know that: no `data` means no `data` key, which
 * is exactly the envelope every consumer written against 0007 already parses.
 */
export function formatJsonError(code: ErrorCode, message: string, data?: ErrorData): string {
  return JSON.stringify(
    { success: false, error: { code, message }, ...(data ? { data: data.payload } : {}) },
    null,
    2,
  );
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
 * One value per line: what `--quiet` prints. Each value is sanitised, so the
 * line count always equals the value count — a caller piping this into `wc -l`
 * or a `for` loop must not read more records than exist (decision 0036 §2).
 */
export function formatValues(values: string[]): string {
  return values.map(textField).join("\n");
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

/**
 * A rendered failure, split by the stream each half belongs on.
 *
 * The split is why this is an object rather than a string: the two halves answer
 * different questions, and a caller that has to remember to write the second one
 * will one day not. Both keys are always present; either may be empty.
 */
export interface RenderedError {
  /** The reason, and any prose about it. Always stderr, in every mode. */
  stderr: string;
  /** The values `--quiet` asked for, one per line. Empty unless there are any. */
  stdout: string;
}

/**
 * Renders an error in the active format (decision 0007), with what the command
 * changed before it failed when there is any (decision 0031 §4).
 *
 * The failure line goes to stderr in every mode: a caller reading stderr is owed
 * the reason whatever else happens. What `data` varies is what accompanies it —
 * a summary under it in text mode, and in `--quiet` the ids themselves, one per
 * line. JSON mode ignores `--quiet` as every other envelope does.
 *
 * **`--quiet`'s values go to stdout, not to stderr.** `-q` is "minimal text for
 * piping" (decision 0007) and exists to hand a shell a value it can capture
 * (decision 0038 §1); `$(…)` and a pipe both read stdout, so an id printed on
 * stderr is a value no caller can take. That matters most on exactly this path:
 * a `create` that failed after making the file printed no success envelope, so
 * the failure is the only place its id appears at all.
 */
export function renderError(
  code: ErrorCode,
  message: string,
  format: OutputFormat,
  quiet = false,
  data?: ErrorData,
): RenderedError {
  if (format === "json") {
    return { stderr: formatJsonError(code, message, data), stdout: "" };
  }
  const values = quiet ? (data?.quiet ?? "") : "";
  const under = quiet ? "" : (data?.text ?? "");
  return {
    stderr: under === "" ? `Error: ${message}\n` : `Error: ${message}\n${under}\n`,
    stdout: values === "" ? "" : `${values}\n`,
  };
}
