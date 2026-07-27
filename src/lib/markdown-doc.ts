/**
 * Markdown → document model (decision 0021).
 *
 * The subset is the one `renderDocument` emits (0009), so the pair round-trips;
 * everything else still lands rather than being refused (0021 §3). One source
 * line is one block: `read` separates blocks with a single newline, so merging
 * soft-wrapped lines the way CommonMark does would fuse paragraphs that came
 * back apart.
 */

import type {
  DocsRange,
  DocsRequest,
  DocsTextStyleWrite,
  DocumentRaw,
  StructuralElementRaw,
  TableRaw,
} from "./docs-api.ts";

export interface SpanStyle {
  bold?: true;
  italic?: true;
  code?: true;
  link?: string;
}

export interface InlineSpan extends SpanStyle {
  text: string;
}

/** A cell is a run of spans; a row is cells; a table is rows. */
export type TableRows = InlineSpan[][][];

export type MarkdownBlock =
  | { kind: "heading"; level: number; spans: InlineSpan[] }
  | { kind: "paragraph"; spans: InlineSpan[] }
  | { kind: "quote"; spans: InlineSpan[] }
  | { kind: "code"; text: string }
  | { kind: "list"; ordered: boolean; level: number; spans: InlineSpan[] }
  | { kind: "table"; rows: TableRows };

/** Something Docs cannot hold, kept as literal text and reported (0021 §3). */
export interface UnsupportedNote {
  line: number;
  kind: "image" | "html";
}

export interface ParsedMarkdown {
  blocks: MarkdownBlock[];
  unsupported: UnsupportedNote[];
}

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const FENCE = /^ {0,3}(```|~~~)/;
const LIST_ITEM = /^( *)([-*+]|\d+[.)])\s+(.*)$/;
const INDENTED = /^ {4,}\S/;
const HTML_LINE = /^ {0,3}<[a-zA-Z!/][^>]*>/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const IMAGE = /^!\[(?:[^\]\\]|\\.)*\]\([^)\s]*\)/;
const LINK = /^\[((?:[^[\]\\]|\\.)*)\]\(([^)\s]*)\)/;

/** True for `| --- | :-: |` — the row that makes the line above it a header. */
function isSeparatorRow(line: string | undefined): boolean {
  if (line === undefined || !TABLE_ROW.test(line)) return false;
  return splitRow(line).every((cell) => /^:?-+:?$/.test(cell));
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function merge(spans: InlineSpan[], style: SpanStyle): InlineSpan[] {
  return spans.map((span) => ({ ...style, ...span }));
}

/** Finds the closing `marker`, skipping one directly after the opener. */
function closingIndex(text: string, marker: string, from: number): number {
  let at = text.indexOf(marker, from);
  while (at === from) at = text.indexOf(marker, at + marker.length);
  return at;
}

interface InlineResult {
  spans: InlineSpan[];
  images: number;
}

function parseInline(source: string): InlineResult {
  const spans: InlineSpan[] = [];
  let images = 0;
  let buffer = "";

  const flush = () => {
    if (buffer !== "") {
      spans.push({ text: buffer });
      buffer = "";
    }
  };
  /** Adds `inner` re-parsed under `style`, keeping the span list flat. */
  const nested = (inner: string, style: SpanStyle) => {
    flush();
    const result = parseInline(inner);
    images += result.images;
    spans.push(...merge(result.spans, style));
  };

  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    const char = source[i] ?? "";

    if (char === "\\" && i + 1 < source.length) {
      buffer += source[i + 1] ?? "";
      i += 2;
      continue;
    }

    if (char === "`") {
      const close = closingIndex(source, "`", i + 1);
      if (close > i) {
        flush();
        spans.push({ text: source.slice(i + 1, close), code: true });
        i = close + 1;
        continue;
      }
    }

    if (char === "!") {
      const image = IMAGE.exec(rest);
      if (image) {
        buffer += image[0];
        images += 1;
        i += image[0].length;
        continue;
      }
    }

    if (char === "[") {
      const link = LINK.exec(rest);
      if (link) {
        nested(link[1] ?? "", { link: link[2] ?? "" });
        i += link[0].length;
        continue;
      }
    }

    if (char === "*" || char === "_") {
      const strong = rest.startsWith(char.repeat(2));
      const marker = char.repeat(strong ? 2 : 1);
      const close = closingIndex(source, marker, i + marker.length);
      if (close > i) {
        nested(source.slice(i + marker.length, close), strong ? { bold: true } : { italic: true });
        i = close + marker.length;
        continue;
      }
    }

    buffer += char;
    i += 1;
  }

  flush();
  return { spans, images };
}

/** Parses Markdown into blocks Docs can hold. Never throws (decision 0021 §3). */
export function parseMarkdown(source: string): ParsedMarkdown {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  const unsupported: UnsupportedNote[] = [];

  const inline = (text: string, line: number): InlineSpan[] => {
    const { spans, images } = parseInline(text);
    for (let n = 0; n < images; n += 1) unsupported.push({ line, kind: "image" });
    return spans;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const number = i + 1;

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1] ?? "```";
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").trimStart().startsWith(marker)) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      i += 1; // the closing fence, or the end of input
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }

    // Indented code, but never a nested list item — `read` indents those too.
    if (INDENTED.test(line) && !LIST_ITEM.test(line)) {
      const body: string[] = [];
      while (i < lines.length) {
        const candidate = lines[i] ?? "";
        if (!INDENTED.test(candidate) || LIST_ITEM.test(candidate)) break;
        body.push(candidate.slice(4));
        i += 1;
      }
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: (heading[1] ?? "#").length,
        spans: inline(heading[2] ?? "", number),
      });
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      i += 1;
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      blocks.push({ kind: "quote", spans: inline(quote[1] ?? "", number) });
      i += 1;
      continue;
    }

    if (TABLE_ROW.test(line) && isSeparatorRow(lines[i + 1])) {
      const rows: TableRows = [splitRow(line).map((cell) => inline(cell, number))];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i] ?? "")) {
        rows.push(splitRow(lines[i] ?? "").map((cell) => inline(cell, i + 1)));
        i += 1;
      }
      blocks.push({ kind: "table", rows });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      const indent = (item[1] ?? "").length;
      blocks.push({
        kind: "list",
        ordered: /^\d/.test(item[2] ?? ""),
        level: Math.floor(indent / 2),
        spans: inline(item[3] ?? "", number),
      });
      i += 1;
      continue;
    }

    if (HTML_LINE.test(line)) {
      unsupported.push({ line: number, kind: "html" });
      blocks.push({ kind: "paragraph", spans: [{ text: line.trim() }] });
      i += 1;
      continue;
    }

    blocks.push({ kind: "paragraph", spans: inline(line, number) });
    i += 1;
  }

  return { blocks, unsupported };
}

// --- Block model → Docs requests (decision 0021 §5) --------------------------

const MONOSPACE = "Courier New";
const QUOTE_INDENT_PT = 36;
const BULLET_PRESET = {
  ordered: "NUMBERED_DECIMAL_ALPHA_ROMAN",
  unordered: "BULLET_DISC_CIRCLE_SQUARE",
} as const;

export interface InsertPlan {
  /** One `batchUpdate` worth of requests, in the order they must be sent. */
  requests: DocsRequest[];
  /** The tables inserted, in document order — cells are filled after a re-read. */
  tables: TableRows[];
}

function spanText(spans: InlineSpan[]): string {
  return spans.map((span) => span.text).join("");
}

/** Tabs are how `createParagraphBullets` learns a list item's nesting level. */
function tabs(block: MarkdownBlock): string {
  return block.kind === "list" ? "\t".repeat(block.level) : "";
}

function blockText(block: MarkdownBlock): string {
  if (block.kind === "code") return block.text;
  if (block.kind === "table") return "";
  return tabs(block) + spanText(block.spans);
}

function textStyleOf(span: InlineSpan): { textStyle: DocsTextStyleWrite; fields: string } | null {
  const textStyle: DocsTextStyleWrite = {};
  const fields: string[] = [];
  if (span.bold) {
    textStyle.bold = true;
    fields.push("bold");
  }
  if (span.italic) {
    textStyle.italic = true;
    fields.push("italic");
  }
  if (span.code) {
    textStyle.weightedFontFamily = { fontFamily: MONOSPACE };
    fields.push("weightedFontFamily");
  }
  if (span.link !== undefined) {
    textStyle.link = { url: span.link };
    fields.push("link");
  }
  return fields.length > 0 ? { textStyle, fields: fields.join(",") } : null;
}

/** Style requests for a run of spans whose first character sits at `start`. */
function spanRequests(spans: InlineSpan[], start: number): DocsRequest[] {
  const requests: DocsRequest[] = [];
  let offset = 0;
  for (const span of spans) {
    const style = textStyleOf(span);
    if (style !== null && span.text !== "") {
      requests.push({
        updateTextStyle: {
          range: { startIndex: start + offset, endIndex: start + offset + span.text.length },
          ...style,
        },
      });
    }
    offset += span.text.length;
  }
  return requests;
}

/**
 * Requests that style one already-inserted block whose text starts at `start`.
 * Bullets come last: `createParagraphBullets` strips the leading tabs, which
 * moves everything after them.
 */
function blockRequests(block: MarkdownBlock, start: number): DocsRequest[] {
  const text = blockText(block);
  const paragraph: DocsRange = { startIndex: start, endIndex: start + text.length + 1 };
  const requests: DocsRequest[] = [];

  if (block.kind === "code") {
    if (text !== "") {
      requests.push({
        updateTextStyle: {
          range: { startIndex: start, endIndex: start + text.length },
          textStyle: { weightedFontFamily: { fontFamily: MONOSPACE } },
          fields: "weightedFontFamily",
        },
      });
    }
  } else if (block.kind !== "table") {
    requests.push(...spanRequests(block.spans, start + tabs(block).length));
  }

  if (block.kind === "heading") {
    requests.push({
      updateParagraphStyle: {
        range: paragraph,
        paragraphStyle: { namedStyleType: `HEADING_${block.level}` },
        fields: "namedStyleType",
      },
    });
  }
  if (block.kind === "quote") {
    requests.push({
      updateParagraphStyle: {
        range: paragraph,
        paragraphStyle: { indentStart: { magnitude: QUOTE_INDENT_PT, unit: "PT" } },
        fields: "indentStart",
      },
    });
  }
  if (block.kind === "list") {
    requests.push({
      createParagraphBullets: {
        range: paragraph,
        bulletPreset: block.ordered ? BULLET_PRESET.ordered : BULLET_PRESET.unordered,
      },
    });
  }
  return requests;
}

type Segment = { kind: "text"; blocks: MarkdownBlock[] } | { kind: "table"; rows: TableRows };

function toSegments(blocks: MarkdownBlock[]): Segment[] {
  const segments: Segment[] = [];
  for (const block of blocks) {
    if (block.kind === "table") {
      segments.push({ kind: "table", rows: block.rows });
      continue;
    }
    const last = segments[segments.length - 1];
    if (last?.kind === "text") last.blocks.push(block);
    else segments.push({ kind: "text", blocks: [block] });
  }
  return segments;
}

/**
 * Requests that write `blocks` at `anchor`.
 *
 * Every insertion targets the same index and the segments go in reverse, so
 * each one pushes its predecessors right and no index has to be recomputed —
 * the arithmetic that would otherwise be wrong the moment a table changes size.
 * A segment's styles follow its own `insertText` immediately, while its text is
 * still at the anchor; within a segment the blocks go back to front, because
 * bullets delete the tabs in front of an item and shift everything after it.
 */
export function planInsert(
  blocks: MarkdownBlock[],
  anchor: number,
  options: { leadingNewline?: boolean } = {},
): InsertPlan {
  const segments = toSegments(blocks);
  const requests: DocsRequest[] = [];
  const tables: TableRows[] = [];

  for (const segment of [...segments].reverse()) {
    if (segment.kind === "table") {
      const columns = segment.rows[0]?.length ?? 0;
      if (segment.rows.length === 0 || columns === 0) continue;
      requests.push({
        insertTable: { location: { index: anchor }, rows: segment.rows.length, columns },
      });
      tables.unshift(segment.rows);
      continue;
    }

    const lines = segment.blocks.map((block) => `${blockText(block)}\n`);
    requests.push({ insertText: { location: { index: anchor }, text: lines.join("") } });

    const starts: number[] = [];
    let offset = anchor;
    for (const line of lines) {
      starts.push(offset);
      offset += line.length;
    }
    for (let i = segment.blocks.length - 1; i >= 0; i -= 1) {
      const block = segment.blocks[i];
      const start = starts[i];
      if (block !== undefined && start !== undefined) requests.push(...blockRequests(block, start));
    }
  }

  // Last at the anchor means first in the document: a paragraph break in front
  // of everything, for an append that must not join the previous paragraph.
  if (options.leadingNewline === true && requests.length > 0) {
    requests.push({ insertText: { location: { index: anchor }, text: "\n" } });
  }

  return { requests, tables };
}

/** The tables our own insertion added, in document order. */
function insertedTables(document: DocumentRaw, anchor: number): TableRaw[] {
  const found: TableRaw[] = [];
  const walk = (content: StructuralElementRaw[]) => {
    for (const element of content) {
      const start = element.startIndex ?? 0;
      if (element.table && start >= anchor) found.push(element.table);
    }
  };
  walk(document.body?.content ?? []);
  return found;
}

/**
 * Cell fills for the tables `planInsert` created, read back from `document`.
 * Descending order throughout: an insert into an earlier cell moves every later
 * one, so the later ones are written first (decision 0021 §5).
 */
export function planTableFills(
  document: DocumentRaw,
  anchor: number,
  tables: TableRows[],
): DocsRequest[] {
  const found = insertedTables(document, anchor);
  const requests: DocsRequest[] = [];

  for (let t = Math.min(found.length, tables.length) - 1; t >= 0; t -= 1) {
    const rows = tables[t] ?? [];
    const rawRows = found[t]?.tableRows ?? [];
    for (let r = rawRows.length - 1; r >= 0; r -= 1) {
      const cells = rawRows[r]?.tableCells ?? [];
      for (let c = cells.length - 1; c >= 0; c -= 1) {
        const spans = rows[r]?.[c] ?? [];
        const text = spanText(spans);
        const start = cells[c]?.content?.[0]?.startIndex;
        if (text === "" || typeof start !== "number") continue;
        requests.push({ insertText: { location: { index: start }, text } });
        requests.push(...spanRequests(spans, start));
      }
    }
  }
  return requests;
}
