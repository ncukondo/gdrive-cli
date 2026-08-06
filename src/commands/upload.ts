import { Command } from "commander";
import { AppError, type CommandResult, type DriveFile, type OutputFormat } from "../types/index.ts";
import { formatValues, line, renderSuccess } from "../lib/output.ts";
import { MY_DRIVE, refuseUnaddressableName, type FindSiblings } from "../lib/names.ts";
import { ROOT_ID } from "../lib/resolve-path.ts";
import type { UploadInput } from "../lib/api.ts";

const DOC_MIME = "application/vnd.google-apps.document";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

const EXT_MIME: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  html: "text/html",
  json: "application/json",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** Guesses a MIME type from a filename extension; octet-stream if unknown. */
export function guessMimeType(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
  return EXT_MIME[ext] ?? "application/octet-stream";
}

/** Resolves the Google conversion target from --as-doc / --as-sheet. */
export function resolveConvertMime(asDoc?: boolean, asSheet?: boolean): string | undefined {
  if (asDoc && asSheet) {
    throw new AppError("INVALID_ARGS", "Use only one of --as-doc or --as-sheet.");
  }
  if (asDoc) return DOC_MIME;
  if (asSheet) return SHEET_MIME;
  return undefined;
}

/** A local file resolved for upload (body is a stream/buffer passed to the API). */
export interface LocalFile {
  body: unknown;
  mimeType: string;
  name: string;
}

export interface UploadDeps {
  resolvePath: (arg: string) => Promise<string>;
  readLocalFile: (path: string) => LocalFile;
  uploadMedia: (input: UploadInput) => Promise<DriveFile>;
  /** What the uploaded file's name would collide with (decision 0055 §1). */
  findSiblings: FindSiblings;
  local: string;
  parent?: string;
  name?: string;
  asDoc?: boolean;
  asSheet?: boolean;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleUpload(deps: UploadDeps): Promise<CommandResult> {
  const convertTo = resolveConvertMime(deps.asDoc, deps.asSheet);
  const localFile = deps.readLocalFile(deps.local);
  const name = deps.name ?? localFile.name;
  const parentId = deps.parent !== undefined ? await deps.resolvePath(deps.parent) : undefined;

  // Decision 0055 §1–§2, before a byte is sent: uploading the same file twice
  // is the ordinary way to reach the collision, and Drive would take both.
  await refuseUnaddressableName({
    name,
    parentId: parentId ?? ROOT_ID,
    findSiblings: deps.findSiblings,
    where: deps.parent ?? MY_DRIVE,
    flag: "--name",
  });

  const input: UploadInput = { name, mimeType: localFile.mimeType, body: localFile.body };
  if (parentId !== undefined) input.parentId = parentId;
  if (convertTo !== undefined) input.convertToMimeType = convertTo;

  const file = await deps.uploadMedia(input);

  deps.write(
    renderSuccess(
      {
        data: { file },
        text: line`Uploaded ${file.name} (${file.id})`,
        quiet: formatValues([file.id]),
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createUploadCommand(): Command {
  return new Command("upload")
    .description("Upload a local file")
    .argument("<local>", "Path to a local file")
    .option("--parent <folder>", "Parent folder ID or path")
    .option("--name <name>", "Name in Drive (defaults to the local filename)")
    .option("--as-doc", "Convert to a Google Doc on upload")
    .option("--as-sheet", "Convert to a Google Sheet on upload");
}
