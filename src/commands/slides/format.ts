import { formatTable, line, reportUnsupported } from "../../lib/output.ts";
import type { OutputFormat } from "../../types/index.ts";
import type { SkippedField, SlidePlanEntry } from "./plan.ts";

/**
 * Why a request could not carry what the document asked for. Each is a fact
 * about Slides rather than about this CLI — except `elements`, which 0051 §3
 * says is two facts, and the plan's own refusal is where they are told apart.
 * The `kind` beside it is the document field `read` reports in.
 *
 * A reason that is only true of *this command* names the one that can do it.
 * A deck's title is its Drive name — one field, measured
 * ([0052](../../../decisions/0052-rename.md)) — so `gdrive rename` changes the
 * title this write cannot, and a report that stopped at "no request changes it"
 * would send a caller away from a command they already have.
 */
const SKIPPED_REASON: Record<string, string> = {
  // Each of the first four is reported from two places — a slide being created,
  // whose layout offers no such placeholder, and one being updated, which has
  // none on it — so each says both rather than the one case its author had in
  // mind while writing it.
  title: "neither the slide nor its layout has a placeholder for it",
  subtitle: "neither the slide nor its layout has a placeholder for it",
  body: "neither the slide nor its layout has a placeholder for it",
  notes: "the slide has no notes shape to write through, and a new one has none until it exists",
  layout: "no request changes the layout an existing slide is built on",
  elements: "`elements` is read-only, and a new slide cannot be given any",
  "presentation.title":
    "a deck's title is its Drive name, which no batchUpdate request changes — `gdrive rename` does",
};

/**
 * What a write left out, because no request could carry it. The same channel
 * `read` uses (0021 §3), because the answer to "why is this not in my deck"
 * belongs beside the answer to "why is this element read-only".
 */
export function reportSkippedFields(
  fields: SkippedField[],
  format: OutputFormat,
  warn: (message: string) => void,
): { unsupported: SkippedField[] } | Record<string, never> {
  return reportUnsupported(fields, {
    format,
    warn,
    prefix: "Not written",
    describe: (field) => {
      const why = SKIPPED_REASON[field.kind] ?? field.kind;
      if (field.index === undefined) return `${field.kind} (${field.title}): ${why}`;
      const name =
        field.title === ""
          ? `document slide ${field.index}`
          : `${field.title} (document slide ${field.index})`;
      return `${field.kind} of ${name}: ${why}`;
    },
  });
}

/** Where an entry acts: a position, or the move that ends at one. */
function position(entry: SlidePlanEntry): string {
  if (entry.index === undefined) return "";
  return entry.from === undefined ? String(entry.index) : `${entry.from}->${entry.index}`;
}

/**
 * The plan as text: a header row and one row per entry, then a line for each
 * rewrite that costs its placeholder's formatting (0030 §2), then a line saying
 * whether it reached the deck. Nothing is padded (decision 0036 §2–§3), so a
 * slide title with a tab in it cannot forge a column.
 */
export function renderSlidePlan(
  entries: SlidePlanEntry[],
  presentationId: string,
  state: { applied: boolean; dryRun: boolean },
): string {
  if (entries.length === 0) return line`No changes to ${presentationId}`;
  const count = entries.length === 1 ? "1 change" : `${entries.length} changes`;

  const table = formatTable(
    ["action", "position", "id", "title", "fields"],
    entries.map((entry) => [
      entry.action,
      position(entry),
      entry.id ?? "",
      entry.title,
      (entry.fields ?? []).join(","),
    ]),
  );

  // Before the summary, because it is the reason to stop and read a --dry-run.
  const warnings = entries
    .filter((entry) => (entry.formatting_loss ?? []).length > 0)
    .map(
      (entry) =>
        line`Rewriting ${(entry.formatting_loss ?? []).join(", ")} on slide ${entry.id ?? ""} drops the inline formatting it had — bold, links, colour.`,
    );

  const summary = state.applied
    ? line`Applied ${count} to ${presentationId}`
    : state.dryRun
      ? line`Planned ${count} to ${presentationId}; --dry-run wrote nothing`
      : line`Planned ${count} to ${presentationId}`;
  return [table, ...warnings, summary].join("\n");
}
