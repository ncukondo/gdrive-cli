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
 * East Asian Wide (`W`) and Fullwidth (`F`) code points — Unicode Annex #11 —
 * the ones a fixed-width terminal draws two columns wide. Written out here
 * rather than pulled from a package: this is a static table that changes only
 * when Unicode assigns a new CJK or emoji block, the CLI ships as an npm
 * package and a compiled binary so every runtime dependency is a deliberate
 * addition ([0002](../../decisions/0002-tech-stack.md)), and the one built-in
 * answer — `Bun.stringWidth` — is barred because shipped code must run under
 * plain Node as well.
 *
 * Emoji blocks are listed whole, so a few unassigned code points inside them
 * measure 2. Two known gaps are deliberate, because the terminal rather than
 * the character decides them: a base character followed by U+FE0F is measured
 * as the base character, and a ZWJ sequence is measured per component.
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // Hangul Jamo initial consonants
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e], // CJK radicals through CJK symbols and punctuation
  [0x3041, 0x33ff], // kana, Hangul compatibility jamo, CJK compatibility
  [0x3400, 0x4dbf], // CJK unified ideographs extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xa000, 0xa4cf], // Yi
  [0xa960, 0xa97f], // Hangul jamo extended-A
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19], // vertical forms
  [0xfe30, 0xfe6f], // CJK compatibility forms, small form variants
  [0xff01, 0xff60], // fullwidth ASCII
  [0xffe0, 0xffe6], // fullwidth signs
  [0x16fe0, 0x16fe4],
  [0x17000, 0x18cd5], // Tangut, Khitan
  [0x1b000, 0x1b2ff], // kana supplement and extensions
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f200, 0x1f320],
  [0x1f32d, 0x1f64f], // emoticons and pictographs
  [0x1f680, 0x1f6ff], // transport and map symbols
  [0x1f7e0, 0x1f7eb],
  [0x1f900, 0x1f9ff], // supplemental symbols and pictographs
  [0x1fa70, 0x1faff], // symbols and pictographs extended-A
  [0x20000, 0x3fffd], // CJK unified ideographs extensions B onward
];

/** Combining marks and format characters, which the terminal draws over or into their neighbour. */
const ZERO_WIDTH = /[\p{Mn}\p{Me}\u200B-\u200F\u2060\uFEFF]/u;

function charWidth(char: string): number {
  if (ZERO_WIDTH.test(char)) return 0;
  const code = char.codePointAt(0);
  if (code === undefined) return 0;
  return WIDE_RANGES.some(([low, high]) => code >= low && code <= high) ? 2 : 1;
}

/**
 * Terminal columns `text` occupies. Every column below pads by this and never
 * by `.length`: a UTF-16 unit is not a column in either direction — `会` is one
 * unit and two columns, an emoji is two units and two columns.
 */
function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += charWidth(char);
  return width;
}

/** `text` followed by enough spaces to fill `width` display columns. */
function padTo(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

/**
 * Derived from the vocabulary rather than written down: a hard-coded 8 was
 * exactly the width of `shortcut`, so `padEnd` added nothing and a real listing
 * printed `shortcut2026-08-03 04:51`. Reading the widest label keeps the column
 * correct for whatever member is added next.
 */
const TYPE_W = Math.max("Type".length, ...FILE_TYPES.map((t) => t.length)) + COL_GAP;
const MOD_W = "YYYY-MM-DD HH:mm".length + COL_GAP;

/**
 * The `Name` column has no vocabulary to derive a width from — Drive decides how
 * long a name is — so it is derived from the table instead, and this is only the
 * floor, kept so a listing of short names looks the way it always has.
 */
const NAME_MIN_W = 27;

/** Renders a file list as an aligned text table (decision 0008). Empty → "". */
export function formatFileTable(files: DriveFile[]): string {
  if (files.length === 0) return "";
  // A name too wide for the column widens the column for every row. Letting the
  // one long row run on instead would put its ID where no other row's is, which
  // is the defect and not a fix for it; truncating is a change to the table that
  // needs its own decision (task 0036, out of scope).
  const nameW = Math.max(NAME_MIN_W, ...files.map((f) => displayWidth(f.name) + COL_GAP));
  const header = padTo("Type", TYPE_W) + padTo("Modified", MOD_W) + padTo("Name", nameW) + "ID";
  const rows = files.map(
    (f) =>
      padTo(f.type, TYPE_W) +
      padTo(formatModified(f.modified), MOD_W) +
      padTo(f.name, nameW) +
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
  return padTo(`${label}:`, LABEL_W) + value;
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
