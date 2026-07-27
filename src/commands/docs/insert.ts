import { Command } from "commander";
import { AppError, type CommandResult, type OutputFormat } from "../../types/index.ts";
import { renderSuccess } from "../../lib/output.ts";
import { endOfBody, type DocumentRaw } from "../../lib/docs-api.ts";
import type { UnsupportedNote } from "../../lib/markdown-doc.ts";
import { parseDocsFormat, reportUnsupported } from "./format.ts";

export interface InsertPosition {
  index?: string;
  at?: string;
}

/**
 * Resolves `--index <n>` / `--at start|end` to a Docs character index
 * (1-based, decision 0009). Exactly one of the two is required.
 */
export function resolveInsertIndex(position: InsertPosition, document: DocumentRaw): number {
  const given = [position.index !== undefined, position.at !== undefined].filter(Boolean).length;
  if (given === 0) {
    throw new AppError("INVALID_ARGS", "Specify a position: --index <n> or --at <start|end>.");
  }
  if (given > 1) {
    throw new AppError("INVALID_ARGS", "Use only one of --index or --at.");
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
        text: `Inserted into ${title} (${documentId})`,
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
    .option("--as <format>", "Read the content as: markdown | text (default markdown)");
}
