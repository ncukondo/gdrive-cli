import { Command } from "commander";
import {
  AppError,
  type CommandResult,
  type DriveFile,
  type FileType,
  type OutputFormat,
} from "../types/index.ts";
import { renderSuccess } from "../lib/output.ts";
import type { ListOptions, OrderKey } from "../lib/api.ts";
import { formatFileTable, formatFilesQuiet } from "./file-format.ts";

const VALID_TYPES: FileType[] = ["folder", "doc", "sheet", "slides", "file"];
const VALID_ORDERS: OrderKey[] = ["name", "modified", "created"];

export function parseType(value: string | undefined): FileType | undefined {
  if (value === undefined) return undefined;
  if (!VALID_TYPES.includes(value as FileType)) {
    throw new AppError(
      "INVALID_ARGS",
      `Invalid --type "${value}". Use: ${VALID_TYPES.join(", ")}.`,
    );
  }
  return value as FileType;
}

export function parseOrder(value: string | undefined): OrderKey | undefined {
  if (value === undefined) return undefined;
  if (!VALID_ORDERS.includes(value as OrderKey)) {
    throw new AppError(
      "INVALID_ARGS",
      `Invalid --order "${value}". Use: ${VALID_ORDERS.join(", ")}.`,
    );
  }
  return value as OrderKey;
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
}

export async function handleLs(deps: LsDeps): Promise<CommandResult> {
  const folderId = deps.folder ? await deps.resolvePath(deps.folder) : "root";
  const options: ListOptions = {};
  if (deps.type !== undefined) options.type = deps.type;
  if (deps.trashed !== undefined) options.trashed = deps.trashed;
  if (deps.limit !== undefined) options.limit = deps.limit;
  if (deps.order !== undefined) options.order = deps.order;

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
    .option("--order <order>", "Sort: name | modified | created");
}
