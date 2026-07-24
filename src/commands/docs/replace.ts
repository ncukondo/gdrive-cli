import { Command } from "commander";
import { AppError, type CommandResult, type OutputFormat } from "../../types/index.ts";
import { renderSuccess } from "../../lib/output.ts";

export interface DocsReplaceDeps {
  resolvePath: (arg: string) => Promise<string>;
  replaceAllText: (
    documentId: string,
    find: string,
    replace: string,
    matchCase: boolean,
  ) => Promise<number>;
  file: string;
  find: string;
  replace: string;
  matchCase?: boolean;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleDocsReplace(deps: DocsReplaceDeps): Promise<CommandResult> {
  if (deps.find === "") {
    throw new AppError("INVALID_ARGS", "--find must not be empty.");
  }

  const documentId = await deps.resolvePath(deps.file);
  const replaced = await deps.replaceAllText(
    documentId,
    deps.find,
    deps.replace,
    deps.matchCase === true,
  );
  const message = `Replaced ${replaced} ${replaced === 1 ? "occurrence" : "occurrences"}`;

  deps.write(
    renderSuccess(
      {
        data: { id: documentId, replaced, message },
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
    .description("Find and replace text across a document")
    .argument("<file>", "Document ID or path")
    .requiredOption("--find <text>", "Text to find")
    .requiredOption("--replace <text>", "Replacement text")
    .option("--match-case", "Match case when finding")
    .option("--all", "Replace all matches (the default)");
}
