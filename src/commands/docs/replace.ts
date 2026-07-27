import { Command } from "commander";
import { AppError, type CommandResult, type OutputFormat } from "../../types/index.ts";
import { renderSuccess } from "../../lib/output.ts";
import type { UnsupportedNote } from "../../lib/markdown-doc.ts";
import { parseDocsFormat, reportUnsupported } from "./format.ts";

export interface DocsReplaceDeps {
  resolvePath: (arg: string) => Promise<string>;
  replaceAllText: (
    documentId: string,
    find: string,
    replace: string,
    matchCase: boolean,
  ) => Promise<number>;
  replaceMarkdown: (
    documentId: string,
    find: string,
    replace: string,
    matchCase: boolean,
  ) => Promise<{ replaced: number; unsupported: UnsupportedNote[] }>;
  readInput: (arg: string) => Promise<string>;
  file: string;
  find: string;
  replace: string;
  matchCase?: boolean;
  as?: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
  warn: (msg: string) => void;
}

export async function handleDocsReplace(deps: DocsReplaceDeps): Promise<CommandResult> {
  const as = parseDocsFormat(deps.as);
  if (deps.find === "") {
    throw new AppError("INVALID_ARGS", "--find must not be empty.");
  }

  const documentId = await deps.resolvePath(deps.file);
  const replacement = await deps.readInput(deps.replace);
  const matchCase = deps.matchCase === true;
  let replaced: number;
  let notes: UnsupportedNote[] = [];
  if (as === "markdown") {
    const result = await deps.replaceMarkdown(documentId, deps.find, replacement, matchCase);
    replaced = result.replaced;
    notes = result.unsupported;
  } else {
    replaced = await deps.replaceAllText(documentId, deps.find, replacement, matchCase);
  }
  const message = `Replaced ${replaced} ${replaced === 1 ? "occurrence" : "occurrences"}`;

  deps.write(
    renderSuccess(
      {
        data: {
          id: documentId,
          replaced,
          message,
          ...reportUnsupported(notes, deps.format, deps.warn),
        },
        text: message,
        quiet: documentId,
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createDocsReplaceCommand(): Command {
  return new Command("replace")
    .description("Find and replace across a document")
    .argument("<file>", "Document ID or path")
    .requiredOption("--find <text>", "Text to find")
    .requiredOption("--replace <text|@file|->", "Replacement content")
    .option("--match-case", "Match case when finding")
    .option("--all", "Replace all matches (the default)")
    .option("--as <format>", "Read the replacement as: markdown | text (default markdown)");
}
