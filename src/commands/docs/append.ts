import { Command } from "commander";
import { AppError, type CommandResult, type OutputFormat } from "../../types/index.ts";
import { renderSuccess } from "../../lib/output.ts";
import { endOfBody, type DocumentRaw } from "../../lib/docs-api.ts";
import type { UnsupportedNote } from "../../lib/markdown-doc.ts";
import { parseDocsFormat, reportUnsupported } from "./format.ts";

export interface DocsAppendDeps {
  resolvePath: (arg: string) => Promise<string>;
  getDocument: (documentId: string) => Promise<DocumentRaw>;
  insertText: (documentId: string, index: number, text: string) => Promise<void>;
  insertMarkdown: (
    documentId: string,
    index: number,
    source: string,
    options: { leadingNewline: boolean },
  ) => Promise<UnsupportedNote[]>;
  readInput: (arg: string) => Promise<string>;
  file: string;
  text: string;
  as?: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
  warn: (msg: string) => void;
}

export async function handleDocsAppend(deps: DocsAppendDeps): Promise<CommandResult> {
  const as = parseDocsFormat(deps.as);
  const text = await deps.readInput(deps.text);
  if (text === "") {
    throw new AppError("INVALID_ARGS", "Nothing to append: the text is empty.");
  }

  const documentId = await deps.resolvePath(deps.file);
  const document = await deps.getDocument(documentId);
  const index = endOfBody(document);
  // Start a new paragraph unless the document is still empty.
  const leadingNewline = index > 1;
  let notes: UnsupportedNote[] = [];
  if (as === "markdown") {
    notes = await deps.insertMarkdown(documentId, index, text, { leadingNewline });
  } else {
    await deps.insertText(documentId, index, leadingNewline ? `\n${text}` : text);
  }

  const title = document.title ?? "";
  deps.write(
    renderSuccess(
      {
        data: { id: documentId, title, ...reportUnsupported(notes, deps.format, deps.warn) },
        text: `Appended to ${title} (${documentId})`,
        quiet: documentId,
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createDocsAppendCommand(): Command {
  return new Command("append")
    .description("Append Markdown (or plain text) at the end of a document")
    .argument("<file>", "Document ID or path")
    .argument("<text|@file|->", "Content to append")
    .option("--as <format>", "Read the content as: markdown | text (default markdown)");
}
