import { parseChoice } from "../../lib/args.ts";
import { formatTable, line, reportUnsupported } from "../../lib/output.ts";
import type { OutputFormat } from "../../types/index.ts";
import type { UnsupportedItemNote } from "../../lib/form-document.ts";
import type { PlanEntry, SkippedItem } from "./plan.ts";

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

/**
 * The items a write left alone because 0028 §2 forbids a request for them —
 * an `unsupported` node the document asked to *add*, which carries the API's
 * resource rather than anything a `createItem` could send. The same channel
 * `read` uses, because the answer to "why is this not in my form" belongs
 * beside the answer to "why is this node opaque".
 */
export function reportSkippedItems(
  items: SkippedItem[],
  format: OutputFormat,
  warn: (message: string) => void,
): { unsupported: SkippedItem[] } | Record<string, never> {
  return reportUnsupported(items, {
    format,
    warn,
    prefix: "Not written",
    describe: (item) =>
      item.title === ""
        ? `document item ${item.index}`
        : `${item.title} (document item ${item.index})`,
  });
}

/** Where an entry acts: a position, or the move that ends at one. */
function position(entry: PlanEntry): string {
  if (entry.index === undefined) return "";
  return entry.from === undefined ? String(entry.index) : `${entry.from}->${entry.index}`;
}

/**
 * The plan as text: a header row and one row per entry, then a line saying
 * whether it reached the form. Nothing is padded (decision 0036 §2–§3), so a
 * question title with a tab in it cannot forge a column.
 */
export function renderPlan(
  entries: PlanEntry[],
  formId: string,
  state: { applied: boolean; dryRun: boolean },
): string {
  const count = String(entries.length);
  if (entries.length === 0) return line`No changes to ${formId}`;

  const table = formatTable(
    ["action", "position", "id", "title"],
    entries.map((entry) => [entry.action, position(entry), entry.id ?? "", entry.title]),
  );
  const summary = state.applied
    ? line`Applied ${count} changes to ${formId}`
    : state.dryRun
      ? line`Planned ${count} changes to ${formId}; --dry-run wrote nothing`
      : line`Planned ${count} changes to ${formId}`;
  return `${table}\n${summary}`;
}
