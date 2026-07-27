import { Command } from "commander";
import type { CommandResult, OutputFormat } from "../../types/index.ts";
import { renderSuccess } from "../../lib/output.ts";
import type { UnsupportedNote } from "../../lib/markdown-doc.ts";
import { parseDocsFormat, reportUnsupported } from "./format.ts";

export interface DocsCreateDeps {
  resolvePath: (arg: string) => Promise<string>;
  createDocument: (title: string) => Promise<{ id: string; title: string }>;
  insertText: (documentId: string, index: number, text: string) => Promise<void>;
  insertMarkdown: (documentId: string, index: number, source: string) => Promise<UnsupportedNote[]>;
  /** Drive move — the Docs API cannot create a document inside a folder. */
  moveFile: (documentId: string, parentId: string) => Promise<unknown>;
  readInput: (arg: string) => Promise<string>;
  title: string;
  content?: string;
  parent?: string;
  as?: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
  warn: (msg: string) => void;
}

export async function handleDocsCreate(deps: DocsCreateDeps): Promise<CommandResult> {
  const as = parseDocsFormat(deps.as);
  const created = await deps.createDocument(deps.title);

  let notes: UnsupportedNote[] = [];
  if (deps.content !== undefined) {
    const text = await deps.readInput(deps.content);
    if (text !== "") {
      if (as === "markdown") notes = await deps.insertMarkdown(created.id, 1, text);
      else await deps.insertText(created.id, 1, text);
    }
  }

  let parentId: string | undefined;
  if (deps.parent !== undefined) {
    parentId = await deps.resolvePath(deps.parent);
    await deps.moveFile(created.id, parentId);
  }

  deps.write(
    renderSuccess(
      {
        data: {
          id: created.id,
          title: created.title,
          ...(parentId !== undefined ? { parent_id: parentId } : {}),
          ...reportUnsupported(notes, deps.format, deps.warn),
        },
        text: `Created ${created.title} (${created.id})`,
        quiet: created.id,
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createDocsCreateCommand(): Command {
  return new Command("create")
    .description("Create a new Google Doc")
    .argument("<title>", "Document title")
    .option("--content <text|@file|->", "Initial body content")
    .option("--parent <folder>", "Parent folder ID or path")
    .option("--as <format>", "Read the content as: markdown | text (default markdown)");
}
