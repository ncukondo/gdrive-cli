import { Command } from "commander";
import { AppError, type CommandResult, type OutputFormat } from "../../types/index.ts";
import { formatValues, line, renderSuccess } from "../../lib/output.ts";
import {
  contentOfSegment,
  findMarkerRanges,
  paragraphBoundary,
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
/**
 * Everything decidable from the command line alone, so a bad invocation costs
 * no round trip. Separate from {@link resolveDeleteRange} because that one
 * needs the document and this one does not.
 */
export function checkDeleteArgs(args: DeleteRangeArgs): void {
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
  if (indices && (args.index === undefined || args.length === undefined)) {
    throw new AppError("INVALID_ARGS", "--index and --length are used together.");
  }
  if (markers && (args.from === undefined || args.to === undefined)) {
    throw new AppError("INVALID_ARGS", "--from and --to are used together.");
  }
  if (args.index !== undefined) positiveInteger(args.index, "--index");
  if (args.length !== undefined) positiveInteger(args.length, "--length");
}

export function resolveDeleteRange(args: DeleteRangeArgs, document: DocumentRaw): DocsRange {
  checkDeleteArgs(args);

  if (args.index !== undefined && args.length !== undefined) {
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
  // A range cannot span two index spaces: index 42 in a footer is not index 42
  // in the body, so two markers in different segments name no range at all
  // (decision 0064 §2).
  if (from.segmentId !== to.segmentId) {
    throw new AppError(
      "INVALID_ARGS",
      `--from "${args.from}" and --to "${args.to}" are in different parts of the document, so there is no range between them. Name two markers in the same body, header, footer or footnote.`,
    );
  }
  // 0062 §3, and read it exactly: a range that covers a **whole paragraph**
  // takes its paragraph mark, so removing one leaves no blank line where it
  // was. Both ends decide that. Extending on `--to` alone deletes a character
  // the caller did not name and merges the paragraph after it into the one
  // before — measured on a real document, `--from world --to world` over
  // "hello world" took six characters for a five-character marker and joined
  // the next paragraph onto it. There is no undo for that.
  const wholeParagraphs = paragraphBoundary(
    document,
    from.startIndex,
    from.segmentId,
  ).atParagraphStart;
  return clamp(
    {
      startIndex: from.startIndex,
      endIndex: wholeParagraphs ? paragraphEnd(document, to.endIndex, to.segmentId) : to.endIndex,
      ...(to.segmentId === undefined ? {} : { segmentId: to.segmentId }),
    },
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
  // Only the body's final mark is the document's; a segment's own last
  // paragraph is bounded by its own content.
  const content = contentOfSegment(document, range.segmentId);
  const end = content[content.length - 1]?.endIndex;
  const last = typeof end === "number" && end > 1 ? end - 1 : 1;
  return range.endIndex > last ? { ...range, endIndex: last } : range;
}

/**
 * The document's own text at each end of a range, for `--dry-run`
 * (decision 0062 §4).
 *
 * A deletion's arguments do not show what it removes — `--from`/`--to` names
 * two ends and the caller is trusting their memory of what lies between them.
 * Echoing the markers back would confirm nothing they did not type; reading the
 * *document* at those indices is what tells them they named the range they
 * meant, and it is the only place the paragraph rule's extra character is
 * visible before it is gone.
 */
function endsOf(
  document: DocumentRaw,
  range: DocsRange,
  width = 24,
): { start: string; end: string } {
  // Characters are read at their own Docs indices, not concatenated. A table
  // occupies a span of the index space and contributes no characters here, so
  // a plain join would put every character after it at the wrong index.
  const at = new Map<number, string>();
  for (const element of document.body?.content ?? []) {
    for (const run of element.paragraph?.elements ?? []) {
      const start = run.startIndex ?? element.startIndex ?? 1;
      const content = run.textRun?.content ?? "";
      for (let k = 0; k < content.length; k += 1) {
        const char = content[k];
        if (char !== undefined) at.set(start + k, char);
      }
    }
  }
  const read = (from: number, to: number): string => {
    let out = "";
    for (let i = from; i < to; i += 1) out += at.get(i) ?? "";
    return out;
  };
  return {
    start: read(range.startIndex, Math.min(range.endIndex, range.startIndex + width)),
    end: read(Math.max(range.startIndex, range.endIndex - width), range.endIndex),
  };
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
  // The argument shape is decided before anything is fetched: naming neither
  // pair, or both, or a bad integer, is an error about the command line and
  // costs no round trip to find out.
  const args = {
    ...(deps.from !== undefined ? { from: deps.from } : {}),
    ...(deps.to !== undefined ? { to: deps.to } : {}),
    ...(deps.index !== undefined ? { index: deps.index } : {}),
    ...(deps.length !== undefined ? { length: deps.length } : {}),
    ...(deps.matchCase !== undefined ? { matchCase: deps.matchCase } : {}),
  };
  checkDeleteArgs(args);

  const documentId = await deps.resolvePath(deps.file);
  const document = await deps.getDocument(documentId);
  const range = resolveDeleteRange(args, document);

  const characters = range.endIndex - range.startIndex;
  const dryRun = deps.dryRun === true;
  const ends = endsOf(document, range);
  if (!dryRun) await deps.deleteRange(documentId, range);

  deps.write(
    renderSuccess(
      {
        data: {
          id: documentId,
          deleted: !dryRun,
          range: { start_index: range.startIndex, end_index: range.endIndex },
          characters,
          ...(dryRun ? { dry_run: true, starts: ends.start, ends: ends.end } : {}),
        },
        text: dryRun
          ? line`Would delete ${String(characters)} characters from ${documentId} (${String(range.startIndex)}–${String(range.endIndex)}), beginning "${ends.start}" and ending "${ends.end}"; --dry-run wrote nothing`
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
