import type { DriveFile } from "../types/index.ts";
import { formatRow, formatTable, formatValues } from "../lib/output.ts";

/** ISO timestamp → `YYYY-MM-DD HH:mm` (UTC) for compact table display. */
export function formatModified(iso: string | null): string {
  if (!iso || iso.length < 16) return iso ?? "";
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** Renders a file list as tab-separated rows (decisions 0008, 0036 §2). Empty → "". */
export function formatFileTable(files: DriveFile[]): string {
  if (files.length === 0) return "";
  return formatTable(
    ["Type", "Modified", "Name", "ID"],
    files.map((f) => [f.type, formatModified(f.modified), f.name, f.id]),
  );
}

/** One file ID per line (quiet mode). */
export function formatFilesQuiet(files: DriveFile[]): string {
  return formatValues(files.map((f) => f.id));
}

function detailLine(label: string, value: string): string {
  return formatRow([`${label}:`, value]);
}

/** Renders a single file's metadata as text (decision 0008 `info`). */
export function formatFileDetail(file: DriveFile): string {
  const lines = [
    detailLine("Name", file.name),
    detailLine("Type", file.type),
    detailLine("ID", file.id),
    detailLine("MIME", file.mime_type),
    detailLine("Size", file.size === null ? "-" : String(file.size)),
    detailLine("Modified", file.modified ?? "-"),
    detailLine("Created", file.created ?? "-"),
  ];
  // What a shortcut points at, so an `info` that deliberately does not follow
  // still hands the caller the id to follow with (decision 0025 §2).
  if (file.target_id !== null) {
    lines.push(detailLine("Target", `${file.target_id} (${file.target_type ?? "file"})`));
  }
  if (file.owners.length > 0) lines.push(detailLine("Owners", file.owners.join(", ")));
  lines.push(detailLine("Trashed", String(file.trashed)));
  if (file.web_view_link) lines.push(detailLine("Link", file.web_view_link));
  return lines.join("\n");
}
