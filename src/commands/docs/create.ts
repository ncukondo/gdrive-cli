import { Command } from "commander";
import type { CommandResult, OutputFormat } from "../../types/index.ts";
import { formatValues, line, renderSuccess } from "../../lib/output.ts";
import type { ParagraphBoundary } from "../../lib/docs-api.ts";
import type { UnsupportedNote } from "../../lib/markdown-doc.ts";
import { parseDocsFormat, reportUnsupported } from "./format.ts";
import { MY_DRIVE, refuseUnaddressableName, type FindSiblings } from "../../lib/names.ts";
import { ROOT_ID } from "../../lib/resolve-path.ts";

export interface DocsCreateDeps {
  resolvePath: (arg: string) => Promise<string>;
  createDocument: (title: string) => Promise<{ id: string; title: string }>;
  insertText: (
    documentId: string,
    index: number,
    text: string,
    boundary: ParagraphBoundary,
  ) => Promise<void>;
  insertMarkdown: (
    documentId: string,
    index: number,
    source: string,
    options: { boundary: ParagraphBoundary },
  ) => Promise<UnsupportedNote[]>;
  /** Drive move — the Docs API cannot create a document inside a folder. */
  moveFile: (documentId: string, parentId: string) => Promise<unknown>;
  /** What the title would collide with where the document lands (decision 0055 §1). */
  findSiblings: FindSiblings;
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

/**
 * Decision 0055 §2 is what puts `--parent` ahead of the create: the title is the
 * Drive name, and a refusal after `documents.create` would leave a document the
 * caller has to go and delete. Resolving the folder first costs nothing extra —
 * it was resolved either way.
 */
export async function handleDocsCreate(deps: DocsCreateDeps): Promise<CommandResult> {
  const as = parseDocsFormat(deps.as);

  const parentId = deps.parent !== undefined ? await deps.resolvePath(deps.parent) : undefined;
  await refuseUnaddressableName({
    name: deps.title,
    parentId: parentId ?? ROOT_ID,
    findSiblings: deps.findSiblings,
    where: deps.parent ?? MY_DRIVE,
  });

  const created = await deps.createDocument(deps.title);

  let notes: UnsupportedNote[] = [];
  if (deps.content !== undefined) {
    const text = await deps.readInput(deps.content);
    if (text !== "") {
      // The document was created a moment ago, so index 1 is both edges of the
      // one empty paragraph it has (decision 0045 §2).
      const boundary = { atParagraphStart: true, atParagraphEnd: true };
      if (as === "markdown") notes = await deps.insertMarkdown(created.id, 1, text, { boundary });
      else await deps.insertText(created.id, 1, text, boundary);
    }
  }

  if (parentId !== undefined) await deps.moveFile(created.id, parentId);

  deps.write(
    renderSuccess(
      {
        data: {
          id: created.id,
          title: created.title,
          ...(parentId !== undefined ? { parent_id: parentId } : {}),
          ...reportUnsupported(notes, deps.format, deps.warn),
        },
        text: line`Created ${created.title} (${created.id})`,
        quiet: formatValues([created.id]),
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
