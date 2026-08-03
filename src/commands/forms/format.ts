import { parseChoice } from "../../lib/args.ts";
import { reportUnsupported } from "../../lib/output.ts";
import type { OutputFormat } from "../../types/index.ts";
import type { UnsupportedItemNote } from "../../lib/form-document.ts";

export type ResponsesEncoding = "table" | "csv" | "json";

const VALID_AS: ResponsesEncoding[] = ["table", "csv", "json"];

/** Validates `--as`, defaulting to `table` — the same set `sheets read` takes. */
export function parseResponsesAs(value: string | undefined): ResponsesEncoding {
  return value === undefined ? "table" : parseChoice(VALID_AS, value, "--as");
}

/**
 * What the schema could not model, kept verbatim under `raw` (0027 §4) and
 * reported through 0021 §3's channel. Both `read` and `responses` report it:
 * the command that only prints the structure telling you while the command
 * that drops answers stays quiet would be the wrong way round.
 */
export function reportUnsupportedItems(
  notes: UnsupportedItemNote[],
  format: OutputFormat,
  warn: (message: string) => void,
): { unsupported: UnsupportedItemNote[] } | Record<string, never> {
  return reportUnsupported(notes, {
    format,
    warn,
    prefix: "Kept as raw",
    describe: (note) => `${note.kind} (item ${note.id})`,
  });
}
