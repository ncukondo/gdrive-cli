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
 * East Asian Wide (`W`) and Fullwidth (`F`) code points — the ones a fixed-width
 * terminal draws two columns wide.
 *
 * Generated from `EastAsianWidth-17.0.0.txt`
 * (`https://www.unicode.org/Public/17.0.0/ucd/EastAsianWidth.txt`) by taking
 * every `W` and `F` entry plus the five blocks that file's header gives a
 * default of `W` (U+3400..4DBF, U+4E00..9FFF, U+F900..FAFF, U+20000..2FFFD,
 * U+30000..3FFFD), then coalescing. `A` (ambiguous) counts as one column, which
 * is its value outside an East Asian context. Regenerate the same way rather
 * than editing an entry by hand.
 *
 * The first version of this table was written from memory of a wcwidth-style
 * list and was wrong for 214 assigned code points in one direction (U+4DC0..4DFF
 * `䷀`, U+1D300..1D356, U+1F7F0 `🟰`) and 245 in the other (U+1F5A5..1F5FA `🖥`,
 * U+3248..324F). Hence the provenance note: the value of a table like this is
 * entirely in where it came from.
 *
 * It follows the standard, and some terminals do not. `string-width@5` and
 * `Bun.stringWidth` both draw U+4DC0 and U+1D300 at one column against Annex
 * #11's two. Annex #11 is at least a written rule that can be checked; the
 * terminals disagree with each other.
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2630, 0x2637],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x268a, 0x268f],
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
  [0x2e80, 0x2e99],
  [0x2e9b, 0x2ef3],
  [0x2f00, 0x2fd5],
  [0x2ff0, 0x303e],
  [0x3041, 0x3096],
  [0x3099, 0x30ff],
  [0x3105, 0x312f],
  [0x3131, 0x318e],
  [0x3190, 0x31e5],
  [0x31ef, 0x321e],
  [0x3220, 0x3247],
  [0x3250, 0xa48c],
  [0xa490, 0xa4c6],
  [0xa960, 0xa97c],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe52],
  [0xfe54, 0xfe66],
  [0xfe68, 0xfe6b],
  [0xff01, 0xff60],
  [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe4],
  [0x16ff0, 0x16ff6],
  [0x17000, 0x18cd5],
  [0x18cff, 0x18d1e],
  [0x18d80, 0x18df2],
  [0x1aff0, 0x1aff3],
  [0x1aff5, 0x1affb],
  [0x1affd, 0x1affe],
  [0x1b000, 0x1b122],
  [0x1b132, 0x1b132],
  [0x1b150, 0x1b152],
  [0x1b155, 0x1b155],
  [0x1b164, 0x1b167],
  [0x1b170, 0x1b2fb],
  [0x1d300, 0x1d356],
  [0x1d360, 0x1d376],
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f200, 0x1f202],
  [0x1f210, 0x1f23b],
  [0x1f240, 0x1f248],
  [0x1f250, 0x1f251],
  [0x1f260, 0x1f265],
  [0x1f300, 0x1f320],
  [0x1f32d, 0x1f335],
  [0x1f337, 0x1f37c],
  [0x1f37e, 0x1f393],
  [0x1f3a0, 0x1f3ca],
  [0x1f3cf, 0x1f3d3],
  [0x1f3e0, 0x1f3f0],
  [0x1f3f4, 0x1f3f4],
  [0x1f3f8, 0x1f43e],
  [0x1f440, 0x1f440],
  [0x1f442, 0x1f4fc],
  [0x1f4ff, 0x1f53d],
  [0x1f54b, 0x1f54e],
  [0x1f550, 0x1f567],
  [0x1f57a, 0x1f57a],
  [0x1f595, 0x1f596],
  [0x1f5a4, 0x1f5a4],
  [0x1f5fb, 0x1f64f],
  [0x1f680, 0x1f6c5],
  [0x1f6cc, 0x1f6cc],
  [0x1f6d0, 0x1f6d2],
  [0x1f6d5, 0x1f6d8],
  [0x1f6dc, 0x1f6df],
  [0x1f6eb, 0x1f6ec],
  [0x1f6f4, 0x1f6fc],
  [0x1f7e0, 0x1f7eb],
  [0x1f7f0, 0x1f7f0],
  [0x1f90c, 0x1f93a],
  [0x1f93c, 0x1f945],
  [0x1f947, 0x1f9ff],
  [0x1fa70, 0x1fa7c],
  [0x1fa80, 0x1fa8a],
  [0x1fa8e, 0x1fac6],
  [0x1fac8, 0x1fac8],
  [0x1facd, 0x1fadc],
  [0x1fadf, 0x1faea],
  [0x1faef, 0x1faf8],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];

/** Combining marks and format characters, which the terminal draws over or into their neighbour. */
const ZERO_WIDTH = /[\p{Mn}\p{Me}\u200B-\u200F\u2060\uFEFF]/u;

/**
 * Emoji modifiers. Annex #11 calls them `W`, but they recolour the emoji before
 * them instead of adding a glyph: `👍🏽` is one two-column picture, not two.
 */
const SKIN_TONE = /^[\u{1F3FB}-\u{1F3FF}]$/u;

/**
 * U+FE0F asks for the emoji form of the character before it. That character is
 * often narrow on its own — `⚠`, `❤`, `▶`, `✔` are all `N` in Annex #11 — and
 * the emoji it selects is drawn wide, so the pair has to be measured together.
 * These are the commonest wide sequences a file name is likely to contain.
 */
const EMOJI_PRESENTATION = "\uFE0F";

function charWidth(char: string): number {
  if (ZERO_WIDTH.test(char) || SKIN_TONE.test(char)) return 0;
  const code = char.codePointAt(0);
  if (code === undefined) return 0;
  return WIDE_RANGES.some(([low, high]) => code >= low && code <= high) ? 2 : 1;
}

/**
 * Terminal columns `text` occupies. Every column below pads by this and never by
 * `.length`: a UTF-16 unit is not a column in either direction — `会` is one unit
 * and two columns, an emoji is two units and two columns.
 *
 * One gap is left deliberately, because the terminal and not the character
 * decides it: a ZWJ sequence is measured per component, so `👨‍👩‍👧` scores 6 where a
 * terminal that supports the sequence draws 2 and one that does not draws 6.
 * Closing it means a grapheme segmenter and a guess about the terminal.
 */
function displayWidth(text: string): number {
  const chars = [...text];
  let width = 0;
  for (const [index, char] of chars.entries()) {
    if (char === EMOJI_PRESENTATION) continue; // already counted, with its base character
    width += chars[index + 1] === EMOJI_PRESENTATION ? 2 : charWidth(char);
  }
  return width;
}

/** `text` followed by enough spaces to fill `width` display columns. */
function padTo(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

/**
 * A row is one line, so a name is too. Drive accepts a newline in a file name —
 * observed, not inferred — and a name carrying one ends the row early and starts
 * a second line with no columns in it at all, which no amount of padding fixes.
 * Every C0/C1 control and both Unicode line separators become a space.
 *
 * The name printed is lossy where this happens. That is a table, whose job is to
 * be read as columns; `-f json` carries the name Drive actually holds (0007).
 */
const CONTROL = /[\p{Cc}\u2028\u2029]/gu;

function oneLine(text: string): string {
  return text.replace(CONTROL, " ");
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
  const names = files.map((f) => oneLine(f.name));
  const nameW = Math.max(NAME_MIN_W, ...names.map((n) => displayWidth(n) + COL_GAP));
  const header = padTo("Type", TYPE_W) + padTo("Modified", MOD_W) + padTo("Name", nameW) + "ID";
  const rows = files.map(
    (f, i) =>
      padTo(f.type, TYPE_W) +
      padTo(formatModified(f.modified), MOD_W) +
      padTo(names[i] ?? "", nameW) +
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
