import { Command } from "commander";
import type { CommandResult, OutputFormat } from "../../types/index.ts";
import { renderSuccess } from "../../lib/output.ts";
import { renderDocument, type DocumentRaw } from "../../lib/docs-api.ts";
import { parseDocsFormat } from "./format.ts";

export interface DocsReadDeps {
  resolvePath: (arg: string) => Promise<string>;
  getDocument: (documentId: string) => Promise<DocumentRaw>;
  file: string;
  as?: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleDocsRead(deps: DocsReadDeps): Promise<CommandResult> {
  const as = parseDocsFormat(deps.as);
  const documentId = await deps.resolvePath(deps.file);
  const document = await deps.getDocument(documentId);
  const content = renderDocument(document, as);

  deps.write(
    renderSuccess(
      {
        data: {
          id: document.documentId ?? documentId,
          title: document.title ?? "",
          format: as,
          content,
        },
        text: content,
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createDocsReadCommand(): Command {
  return new Command("read")
    .description("Export a document's body as Markdown or plain text")
    .argument("<file>", "Document ID or path")
    .option("--as <format>", "Render as: markdown | text (default markdown)");
}
