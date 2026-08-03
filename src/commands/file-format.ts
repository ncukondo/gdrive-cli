import { FILE_TYPES } from "../types/index.ts";
import type { DriveFile } from "../types/index.ts";

/** ISO timestamp → `YYYY-MM-DD HH:mm` (UTC) for compact table display. */
export function formatModified(iso: string | null): string {
  if (!iso || iso.length < 16) return iso ?? "";
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** Space between one column's widest value and the next column's first character. */
const COL_GAP = 2;

/**
 * Derived from the vocabulary rather than written down: a hard-coded 8 was
 * exactly the width of `shortcut`, so `padEnd` added nothing and a real listing
 * printed `shortcut2026-08-03 04:51`. Reading the widest label keeps the column
 * correct for whatever member is added next.
 */
const TYPE_W = Math.max("Type".length, ...FILE_TYPES.map((t) => t.length)) + COL_GAP;
const MOD_W = "YYYY-MM-DD HH:mm".length + COL_GAP;
const NAME_W = 27;

/** Renders a file list as an aligned text table (decision 0008). Empty → "". */
export function formatFileTable(files: DriveFile[]): string {
  if (files.length === 0) return "";
  const header = "Type".padEnd(TYPE_W) + "Modified".padEnd(MOD_W) + "Name".padEnd(NAME_W) + "ID";
  const rows = files.map(
    (f) =>
      f.type.padEnd(TYPE_W) +
      formatModified(f.modified).padEnd(MOD_W) +
      f.name.padEnd(NAME_W) +
      f.id,
  );
  return [header, ...rows].join("\n");
}

/** One file ID per line (quiet mode). */
export function formatFilesQuiet(files: DriveFile[]): string {
  return files.map((f) => f.id).join("\n");
}

const LABEL_W = 11;

function detailLine(label: string, value: string): string {
  return `${label}:`.padEnd(LABEL_W) + value;
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
