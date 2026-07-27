import { Command } from "commander";
import {
  AppError,
  type CommandResult,
  type DriveFile,
  type FileType,
  type OutputFormat,
} from "../types/index.ts";
import { renderSuccess } from "../lib/output.ts";
import { parseChoice } from "../lib/args.ts";
import type { DriveScope, ListOptions, OrderKey } from "../lib/api.ts";
import { formatFileTable, formatFilesQuiet } from "./file-format.ts";

const VALID_TYPES: FileType[] = ["folder", "doc", "sheet", "slides", "file"];
const VALID_ORDERS: OrderKey[] = ["name", "modified", "created"];

export function parseType(value: string | undefined): FileType | undefined {
  return value === undefined ? undefined : parseChoice(VALID_TYPES, value, "--type");
}

export function parseOrder(value: string | undefined): OrderKey | undefined {
  return value === undefined ? undefined : parseChoice(VALID_ORDERS, value, "--order");
}

export function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new AppError("INVALID_ARGS", `Invalid --limit "${value}". Use a positive integer.`);
  }
  return n;
}

export interface LsDeps {
  resolvePath: (arg: string) => Promise<string>;
  listChildren: (folderId: string, options: ListOptions) => Promise<DriveFile[]>;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
  folder?: string;
  type?: FileType;
  trashed?: boolean;
  limit?: number;
  order?: OrderKey;
  /** Widened listing scope from `--all-drives` / `--drive` (decision 0016). */
  scope?: DriveScope;
}

export async function handleLs(deps: LsDeps): Promise<CommandResult> {
  const folderId = deps.folder ? await deps.resolvePath(deps.folder) : "root";
  const options: ListOptions = {};
  if (deps.type !== undefined) options.type = deps.type;
  if (deps.trashed !== undefined) options.trashed = deps.trashed;
  if (deps.limit !== undefined) options.limit = deps.limit;
  if (deps.order !== undefined) options.order = deps.order;
  if (deps.scope !== undefined) options.scope = deps.scope;

  const files = await deps.listChildren(folderId, options);

  deps.write(
    renderSuccess(
      { data: { files }, text: formatFileTable(files), quiet: formatFilesQuiet(files) },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createLsCommand(): Command {
  return new Command("ls")
    .description("List a folder's children (My Drive root if omitted)")
    .argument("[folder]", "Folder ID or path")
    .option("--type <type>", "Filter by type: folder | doc | sheet | slides | file")
    .option("--trashed", "List trashed files")
    .option("-n, --limit <n>", "Maximum number of files")
    .option("--order <order>", "Sort: name | modified | created")
    .option("--all-drives", "Include every shared drive as well as My Drive")
    .option("--drive <name>", "Limit to the shared drive with this name");
}
