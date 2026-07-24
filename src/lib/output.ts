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

/** Renders an error for stderr in the active format (decision 0007). */
export function renderError(code: ErrorCode, message: string, format: OutputFormat): string {
  if (format === "json") {
    return formatJsonError(code, message);
  }
  return `Error: ${message}\n`;
}
