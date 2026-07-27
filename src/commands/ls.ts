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
  /** Listing scope from `--drive <name>` (decision 0016). */
  scope?: DriveScope;
}

/**
 * Where `ls` starts when no folder is named. A shared drive's id doubles as its
 * root folder id, so `--drive X` on its own means "the root of X" — without
 * this it would send `'root' in parents`, which still names My Drive.
 */
function defaultFolderId(scope?: DriveScope): string {
  return scope !== undefined && scope.kind === "drive" ? scope.driveId : "root";
}

/**
 * `--drive` picks the starting folder, so a folder argument would be a second,
 * conflicting answer to the same question. It used to resolve against My Drive
 * with the scope silently ignored, which returned the wrong folder's contents
 * rather than an error (decision 0016 §2).
 */
function rejectFolderWithScope(deps: LsDeps): void {
  if (deps.folder === undefined || deps.scope === undefined) return;
  throw new AppError(
    "INVALID_ARGS",
    "--drive cannot be combined with a folder argument. " +
      'Name the folder instead: `gdrive ls "drive:<drive>/<folder>"`, or pass its ID.',
  );
}

export async function handleLs(deps: LsDeps): Promise<CommandResult> {
  rejectFolderWithScope(deps);
  const folderId = deps.folder ? await deps.resolvePath(deps.folder) : defaultFolderId(deps.scope);
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
    .option("--drive <name>", "List the root of this shared drive (see `gdrive drives`)");
}
