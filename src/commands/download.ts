import { Command } from "commander";
import {
  AppError,
  type CommandResult,
  type DriveFile,
  type FileType,
  type OutputFormat,
} from "../types/index.ts";
import { line, renderSuccess } from "../lib/output.ts";
import { parseChoice } from "../lib/args.ts";
import type { ResolvedTarget } from "../lib/resolve-path.ts";

export type ExportAs = "pdf" | "docx" | "xlsx" | "csv" | "md" | "txt";

const VALID_EXPORT_AS: ExportAs[] = ["pdf", "docx", "xlsx", "csv", "md", "txt"];

const EXPORT_MIME: Record<ExportAs, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  md: "text/markdown",
  txt: "text/plain",
};

/** Default export MIME for a Google-native file when `--export-as` is omitted. */
const DEFAULT_EXPORT: Partial<Record<FileType, string>> = {
  doc: EXPORT_MIME.pdf,
  sheet: EXPORT_MIME.csv,
  slides: EXPORT_MIME.pdf,
};

export function parseExportAs(value: string | undefined): ExportAs | undefined {
  return value === undefined ? undefined : parseChoice(VALID_EXPORT_AS, value, "--export-as");
}

function byteLengthOf(content: unknown): number | null {
  if (typeof content === "string") return Buffer.byteLength(content);
  if (content instanceof ArrayBuffer) return content.byteLength;
  if (ArrayBuffer.isView(content)) return content.byteLength;
  return null;
}

export interface DownloadDeps {
  /**
   * `<file>` is content — "read what is in this" — so it follows a shortcut
   * (decision 0025 §1), and hands back any metadata it had to fetch on the way.
   */
  resolveTarget: (arg: string) => Promise<ResolvedTarget>;
  getFile: (fileId: string) => Promise<DriveFile>;
  downloadMedia: (fileId: string) => Promise<unknown>;
  exportFile: (fileId: string, mimeType: string) => Promise<unknown>;
  writeFile: (path: string, content: unknown) => void;
  writeStdout: (content: unknown) => void;
  file: string;
  output?: string;
  exportAs?: ExportAs;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

export async function handleDownload(deps: DownloadDeps): Promise<CommandResult> {
  const { id: fileId, file } = await deps.resolveTarget(deps.file);
  // Resolving an id-shaped argument, or a shortcut, already fetched exactly the
  // metadata this needs; only a plain path leaves it to be fetched (0025 §4).
  const meta = file ?? (await deps.getFile(fileId));
  const isGoogleNative = meta.mime_type.startsWith("application/vnd.google-apps");

  if (deps.exportAs !== undefined && !isGoogleNative) {
    throw new AppError(
      "INVALID_ARGS",
      "--export-as applies only to Google Docs/Sheets/Slides. Omit it to download binary content.",
    );
  }

  let content: unknown;
  if (deps.exportAs !== undefined) {
    content = await deps.exportFile(fileId, EXPORT_MIME[deps.exportAs]);
  } else if (isGoogleNative) {
    const mime = DEFAULT_EXPORT[meta.type];
    if (!mime) {
      throw new AppError(
        "INVALID_ARGS",
        `Cannot download a ${meta.type} directly; specify --export-as <pdf|docx|xlsx|csv|md|txt>.`,
      );
    }
    content = await deps.exportFile(fileId, mime);
  } else {
    content = await deps.downloadMedia(fileId);
  }

  // No -o: raw content to stdout so it can be piped; no envelope/messages.
  if (deps.output === undefined) {
    deps.writeStdout(content);
    return { exitCode: 0 };
  }

  deps.writeFile(deps.output, content);
  deps.write(
    renderSuccess(
      {
        data: { file: meta.name, id: meta.id, path: deps.output, bytes: byteLengthOf(content) },
        text: line`Downloaded ${meta.name} to ${deps.output}`,
        quiet: deps.output,
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createDownloadCommand(): Command {
  return new Command("download")
    .description("Download binary content, or export a Doc/Sheet/Slides")
    .argument("<file>", "File ID or path")
    .option("-o, --output <path>", "Write to a file (stdout if omitted)")
    .option("--export-as <format>", "Export format: pdf | docx | xlsx | csv | md | txt");
}
