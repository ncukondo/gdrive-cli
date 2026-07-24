import { Command } from "commander";
import type { CommandResult, OutputFormat } from "../../types/index.ts";
import { renderSuccess } from "../../lib/output.ts";
import { parseChoice } from "../../lib/args.ts";
import { renderDocument, type DocsRenderFormat, type DocumentRaw } from "../../lib/docs-api.ts";

const VALID_AS: DocsRenderFormat[] = ["markdown", "text"];

/** Validates `--as`, defaulting to `markdown` (decision 0009). */
export function parseRenderAs(value: string | undefined): DocsRenderFormat {
  return value === undefined ? "markdown" : parseChoice(VALID_AS, value, "--as");
}

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
  const as = parseRenderAs(deps.as);
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
