import { Command } from "commander";
import type { CommandResult, FileType, OutputFormat } from "../types/index.ts";
import { line, renderSuccess } from "../lib/output.ts";
import type { DriveScope, Listing, ListOptions, OrderKey } from "../lib/api.ts";
import { formatFileTable, formatFilesQuiet } from "./file-format.ts";
import { truncationNote, TYPE_OPTION_DESCRIPTION } from "./ls.ts";

export interface SearchDeps {
  searchFiles: (query: string, options: ListOptions) => Promise<Listing>;
  query: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
  type?: FileType;
  limit?: number;
  order?: OrderKey;
  /** Widened search scope from `--all-drives` / `--drive` (decision 0016). */
  scope?: DriveScope;
}

export async function handleSearch(deps: SearchDeps): Promise<CommandResult> {
  const options: ListOptions = {};
  if (deps.type !== undefined) options.type = deps.type;
  if (deps.limit !== undefined) options.limit = deps.limit;
  if (deps.order !== undefined) options.order = deps.order;
  if (deps.scope !== undefined) options.scope = deps.scope;

  const { files, complete } = await deps.searchFiles(deps.query, options);

  const text =
    files.length === 0
      ? line`No files found matching "${deps.query}".`
      : formatFileTable(files) + truncationNote(complete);

  deps.write(
    renderSuccess(
      { data: { files, complete }, text, quiet: formatFilesQuiet(files) },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createSearchCommand(): Command {
  return new Command("search")
    .description("Search files by name or full text")
    .argument("<query>", "Search query")
    .option("--type <type>", TYPE_OPTION_DESCRIPTION)
    .option("-n, --limit <n>", "Maximum number of files")
    .option("--order <order>", "Sort: name | modified | created")
    .option("--all-drives", "Search every shared drive as well as My Drive")
    .option("--drive <name>", "Search only the shared drive with this name");
}
