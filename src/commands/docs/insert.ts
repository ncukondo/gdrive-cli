import { Command } from "commander";
import { AppError, type CommandResult, type OutputFormat } from "../../types/index.ts";
import { line, renderSuccess } from "../../lib/output.ts";
import { endOfBody, findMarkerRanges, type DocumentRaw } from "../../lib/docs-api.ts";
import type { UnsupportedNote } from "../../lib/markdown-doc.ts";
import { parseDocsFormat, reportUnsupported } from "./format.ts";

export interface InsertPosition {
  index?: string;
  at?: string;
  before?: string;
  after?: string;
  matchCase?: boolean;
}

/**
 * The index of a marker that must match exactly once (decision 0022 §2).
 * `replace` acts on every occurrence because substitution is idempotent in a
 * way insertion is not: a draft written into three places is a mistake you
 * only find after it is written.
 */
function resolveMarkerIndex(
  marker: string,
  side: "before" | "after",
  document: DocumentRaw,
  matchCase: boolean,
): number {
  if (marker === "") {
    throw new AppError("INVALID_ARGS", `--${side} must not be empty.`);
  }
  const ranges = findMarkerRanges(document, marker, matchCase);
  const only = ranges[0];
  if (ranges.length === 0 || only === undefined) {
    throw new AppError("NOT_FOUND", `No such marker in the document: "${marker}".`);
  }
  if (ranges.length > 1) {
    throw new AppError(
      "INVALID_ARGS",
      `Marker "${marker}" matches ${ranges.length} times; it must match exactly once.` +
        (matchCase ? "" : " Try --match-case."),
    );
  }
  return side === "before" ? only.startIndex : only.endIndex;
}

/**
 * Resolves one of `--index <n>` / `--at start|end` / `--before|--after <marker>`
 * to a Docs character index (1-based, decisions 0009 and 0022). Exactly one is
 * required. The marker walk is `replace`'s, so "found" means the same thing in
 * both commands — table cells included, which is to say excluded (0021 §6).
 */
export function resolveInsertIndex(position: InsertPosition, document: DocumentRaw): number {
  const given = [position.index, position.at, position.before, position.after].filter(
    (value) => value !== undefined,
  ).length;
  if (given === 0) {
    throw new AppError(
      "INVALID_ARGS",
      "Specify a position: --index <n>, --at <start|end>, or --before|--after <marker>.",
    );
  }
  if (given > 1) {
    throw new AppError("INVALID_ARGS", "Use only one of --index, --at, --before, or --after.");
  }

  if (position.index !== undefined) {
    const n = Number.parseInt(position.index, 10);
    if (!Number.isInteger(n) || n < 1) {
      throw new AppError(
        "INVALID_ARGS",
        `Invalid --index "${position.index}". Use an integer >= 1.`,
      );
    }
    return n;
  }

  const matchCase = position.matchCase === true;
  if (position.before !== undefined) {
    return resolveMarkerIndex(position.before, "before", document, matchCase);
  }
  if (position.after !== undefined) {
    return resolveMarkerIndex(position.after, "after", document, matchCase);
  }

  if (position.at === "start") return 1;
  if (position.at === "end") return endOfBody(document);
  throw new AppError("INVALID_ARGS", `Invalid --at "${position.at}". Use: start, end.`);
}

export interface DocsInsertDeps {
  resolvePath: (arg: string) => Promise<string>;
  getDocument: (documentId: string) => Promise<DocumentRaw>;
  insertText: (documentId: string, index: number, text: string) => Promise<void>;
  insertMarkdown: (documentId: string, index: number, source: string) => Promise<UnsupportedNote[]>;
  readInput: (arg: string) => Promise<string>;
  file: string;
  text: string;
  index?: string;
  at?: string;
  before?: string;
  after?: string;
  matchCase?: boolean;
  as?: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
  warn: (msg: string) => void;
}

export async function handleDocsInsert(deps: DocsInsertDeps): Promise<CommandResult> {
  const as = parseDocsFormat(deps.as);
  const text = await deps.readInput(deps.text);
  if (text === "") {
    throw new AppError("INVALID_ARGS", "Nothing to insert: the text is empty.");
  }

  const documentId = await deps.resolvePath(deps.file);
  const document = await deps.getDocument(documentId);
  const index = resolveInsertIndex(
    {
      ...(deps.index !== undefined ? { index: deps.index } : {}),
      ...(deps.at !== undefined ? { at: deps.at } : {}),
      ...(deps.before !== undefined ? { before: deps.before } : {}),
      ...(deps.after !== undefined ? { after: deps.after } : {}),
      ...(deps.matchCase === true ? { matchCase: true } : {}),
    },
    document,
  );
  let notes: UnsupportedNote[] = [];
  if (as === "markdown") notes = await deps.insertMarkdown(documentId, index, text);
  else await deps.insertText(documentId, index, text);

  const title = document.title ?? "";
  deps.write(
    renderSuccess(
      {
        data: {
          id: documentId,
          title,
          index,
          ...reportUnsupported(notes, deps.format, deps.warn),
        },
        text: line`Inserted into ${title} (${documentId})`,
        quiet: documentId,
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createDocsInsertCommand(): Command {
  return new Command("insert")
    .description("Insert Markdown (or plain text) at a position in a document")
    .argument("<file>", "Document ID or path")
    .argument("<text|@file|->", "Content to insert")
    .option("--index <n>", "1-based character index in the body")
    .option("--at <where>", "Insert at: start | end")
    .option("--before <marker>", "Insert in front of a marker that occurs once")
    .option("--after <marker>", "Insert just after a marker that occurs once")
    .option("--match-case", "Match case when looking for the marker")
    .option("--as <format>", "Read the content as: markdown | text (default markdown)");
}
