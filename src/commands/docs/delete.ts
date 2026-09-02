import { Command } from "commander";
import { AppError, type CommandResult, type OutputFormat } from "../../types/index.ts";
import { formatValues, line, renderSuccess } from "../../lib/output.ts";
import {
  endOfBody,
  findMarkerRanges,
  paragraphEnd,
  type DocsRange,
  type DocumentRaw,
} from "../../lib/docs-api.ts";

export interface DeleteRangeArgs {
  from?: string;
  to?: string;
  index?: string;
  length?: string;
  matchCase?: boolean;
}

/** A marker that must name one place, so a deletion cannot land on a guess. */
function onlyRange(
  marker: string,
  side: "from" | "to",
  document: DocumentRaw,
  matchCase: boolean,
): DocsRange {
  if (marker === "") {
    throw new AppError("INVALID_ARGS", `--${side} must not be empty.`);
  }
  const ranges = findMarkerRanges(document, marker, matchCase);
  const only = ranges[0];
  if (only === undefined) {
    throw new AppError("NOT_FOUND", `No such marker in the document: "${marker}".`);
  }
  if (ranges.length > 1) {
    // 0022 §2's rule, and it matters more here: an insert into three places is
    // a mistake you find afterwards, a deletion of three is one you cannot.
    throw new AppError(
      "INVALID_ARGS",
      `Marker "${marker}" matches ${ranges.length} times; it must match exactly once.` +
        (matchCase ? "" : " Try --match-case."),
    );
  }
  return only;
}

function positiveInteger(raw: string, flag: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new AppError("INVALID_ARGS", `Invalid ${flag} "${raw}". Use an integer >= 1.`);
  }
  return n;
}

/**
 * The range `deleteContentRange` is sent, resolved against a document the caller
 * already fetched (decision 0062 §1).
 *
 * Two ways to name one and no more. `--from`/`--to` is the shape that matters,
 * because it is the only one that can remove a **table**: a table's cells are
 * not reachable by marker (0021 §6), so a range whose ends lie either side of
 * one is the only way to name it at all — which is the half of issue #41 that
 * had no workaround.
 */
export function resolveDeleteRange(args: DeleteRangeArgs, document: DocumentRaw): DocsRange {
  const markers = args.from !== undefined || args.to !== undefined;
  const indices = args.index !== undefined || args.length !== undefined;

  if (markers && indices) {
    throw new AppError("INVALID_ARGS", "Use either --from/--to or --index/--length, not both.");
  }
  if (!markers && !indices) {
    throw new AppError(
      "INVALID_ARGS",
      "Specify what to delete: --from <marker> --to <marker>, or --index <n> --length <n>.",
    );
  }

  if (indices) {
    if (args.index === undefined || args.length === undefined) {
      throw new AppError("INVALID_ARGS", "--index and --length are used together.");
    }
    const startIndex = positiveInteger(args.index, "--index");
    const length = positiveInteger(args.length, "--length");
    return clamp({ startIndex, endIndex: startIndex + length }, document);
  }

  if (args.from === undefined || args.to === undefined) {
    throw new AppError("INVALID_ARGS", "--from and --to are used together.");
  }
  const matchCase = args.matchCase === true;
  const from = onlyRange(args.from, "from", document, matchCase);
  const to = onlyRange(args.to, "to", document, matchCase);
  if (to.endIndex <= from.startIndex) {
    throw new AppError(
      "INVALID_ARGS",
      `--to "${args.to}" is at or before --from "${args.from}". Name the ends in document order.`,
    );
  }
  // 0062 §3: a range that reaches a paragraph's last character takes its
  // newline too, so removing a paragraph leaves no blank line where it was.
  // That off-by-one is the whole difference from an empty `--replace`, which is
  // what the report tried first.
  return clamp(
    { startIndex: from.startIndex, endIndex: paragraphEnd(document, to.endIndex) },
    document,
  );
}

/**
 * Docs will not remove the body's final paragraph mark, so a range that reaches
 * it stops one character short. This is the API's rule rather than a choice,
 * and honouring it quietly beats failing a deletion that is otherwise exactly
 * what was asked for.
 */
function clamp(range: DocsRange, document: DocumentRaw): DocsRange {
  const last = endOfBody(document);
  return range.endIndex > last ? { startIndex: range.startIndex, endIndex: last } : range;
}

export interface DocsDeleteDeps {
  resolvePath: (arg: string) => Promise<string>;
  getDocument: (documentId: string) => Promise<DocumentRaw>;
  deleteRange: (documentId: string, range: DocsRange) => Promise<void>;
  file: string;
  from?: string;
  to?: string;
  index?: string;
  length?: string;
  matchCase?: boolean;
  dryRun?: boolean;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleDocsDelete(deps: DocsDeleteDeps): Promise<CommandResult> {
  const documentId = await deps.resolvePath(deps.file);
  const document = await deps.getDocument(documentId);
  const range = resolveDeleteRange(
    {
      ...(deps.from !== undefined ? { from: deps.from } : {}),
      ...(deps.to !== undefined ? { to: deps.to } : {}),
      ...(deps.index !== undefined ? { index: deps.index } : {}),
      ...(deps.length !== undefined ? { length: deps.length } : {}),
      ...(deps.matchCase !== undefined ? { matchCase: deps.matchCase } : {}),
    },
    document,
  );

  const characters = range.endIndex - range.startIndex;
  const dryRun = deps.dryRun === true;
  if (!dryRun) await deps.deleteRange(documentId, range);

  deps.write(
    renderSuccess(
      {
        data: {
          id: documentId,
          deleted: !dryRun,
          range: { start_index: range.startIndex, end_index: range.endIndex },
          characters,
          ...(dryRun ? { dry_run: true } : {}),
        },
        text: dryRun
          ? line`Would delete ${String(characters)} characters from ${documentId} (${String(range.startIndex)}–${String(range.endIndex)}); --dry-run wrote nothing`
          : line`Deleted ${String(characters)} characters from ${documentId}`,
        quiet: formatValues([String(characters)]),
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createDocsDeleteCommand(): Command {
  return new Command("delete")
    .description("Remove a range of a document's content")
    .argument("<file>", "Document ID or path")
    .option("--from <marker>", "Delete from the start of this text")
    .option("--to <marker>", "…through the end of this text")
    .option("--index <n>", "Delete from this character index instead")
    .option("--length <n>", "…this many characters")
    .option("--match-case", "Match --from and --to case-sensitively")
    .option("--dry-run", "Report the range and delete nothing");
}
