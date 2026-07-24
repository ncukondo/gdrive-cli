import { Command } from "commander";
import { AppError, type CommandResult, type OutputFormat } from "../../types/index.ts";
import { renderSuccess } from "../../lib/output.ts";
import { endOfBody, type DocumentRaw } from "../../lib/docs-api.ts";

export interface DocsAppendDeps {
  resolvePath: (arg: string) => Promise<string>;
  getDocument: (documentId: string) => Promise<DocumentRaw>;
  insertText: (documentId: string, index: number, text: string) => Promise<void>;
  readInput: (arg: string) => Promise<string>;
  file: string;
  text: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleDocsAppend(deps: DocsAppendDeps): Promise<CommandResult> {
  const text = await deps.readInput(deps.text);
  if (text === "") {
    throw new AppError("INVALID_ARGS", "Nothing to append: the text is empty.");
  }

  const documentId = await deps.resolvePath(deps.file);
  const document = await deps.getDocument(documentId);
  const index = endOfBody(document);
  // Start a new paragraph unless the document is still empty.
  await deps.insertText(documentId, index, index > 1 ? `\n${text}` : text);

  const title = document.title ?? "";
  deps.write(
    renderSuccess(
      {
        data: { id: documentId, title },
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
    .description("Append a paragraph at the end of a document")
    .argument("<file>", "Document ID or path")
    .argument("<text|@file|->", "Text to append");
}
