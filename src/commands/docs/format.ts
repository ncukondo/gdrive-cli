import { parseChoice } from "../../lib/args.ts";
import type { OutputFormat } from "../../types/index.ts";
import type { DocsRenderFormat } from "../../lib/docs-api.ts";
import type { UnsupportedNote } from "../../lib/markdown-doc.ts";

const VALID_AS: DocsRenderFormat[] = ["markdown", "text"];

/**
 * Validates `--as`. Markdown is the default on both sides of `docs`: `read`
 * renders it (0009) and the write commands parse it (0021 §1), so the pipe
 * between them keeps its structure.
 */
export function parseDocsFormat(value: string | undefined): DocsRenderFormat {
  return value === undefined ? "markdown" : parseChoice(VALID_AS, value, "--as");
}

/**
 * What Docs could not hold, kept as literal text (0021 §3). Text mode gets one
 * line on stderr so stdout stays pipeable; JSON mode gets the field instead.
 */
export function reportUnsupported(
  notes: UnsupportedNote[],
  format: OutputFormat,
  warn: (message: string) => void,
): { unsupported: UnsupportedNote[] } | Record<string, never> {
  if (notes.length === 0) return {};
  if (format === "text") {
    const listed = notes.map((note) => `${note.kind} (line ${note.line})`).join(", ");
    warn(`Kept as plain text: ${listed}`);
  }
  return { unsupported: notes };
}
