/**
 * Markdown → document model (decision 0021).
 *
 * The subset is the one `renderDocument` emits (0009), so the pair round-trips;
 * everything else still lands rather than being refused (0021 §3). One source
 * line is one block: `read` separates blocks with a single newline, so merging
 * soft-wrapped lines the way CommonMark does would fuse paragraphs that came
 * back apart.
 */

import type { DocsRange, DocsRequest, DocsTextStyleWrite, TableRaw } from "./docs-api.ts";

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
  | {
      kind: "list";
      ordered: boolean;
      level: number;
      /** The ordinal the source wrote, for an ordered item (decision 0023 §1). */
      number?: number;
      /** Joins the Docs list the previous ordered run opened, rather than starting one. */
      continues?: true;
      spans: InlineSpan[];
    }
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
/** `<scheme:…>` — any scheme, as CommonMark defines an autolink (0023 §6). */
const AUTOLINK = /^<([a-zA-Z][a-zA-Z0-9+.-]*:[^<>\s]*)>/;
/** A bare URL, `http(s)` only; the native import links these too (0023 §6). */
const BARE_URL = /^https?:\/\/[^\s<>]+/;
/** Sentence punctuation that a bare URL should not swallow. */
const URL_TAIL = /[.,;:!?]+$/;
const ORDERED_MARKER = /^(\d+)[.)]$/;

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

    if (char === "<") {
      const auto = AUTOLINK.exec(rest);
      if (auto) {
        const url = auto[1] ?? "";
        flush();
        spans.push({ text: url, link: url });
        i += auto[0].length;
        continue;
      }
    }

    // A bare URL only starts on a word boundary, so `xhttps://…` is not one.
    if (char === "h" && !/[A-Za-z0-9]/.test(source[i - 1] ?? "")) {
      const bare = BARE_URL.exec(rest);
      if (bare) {
        const url = (bare[0] ?? "").replace(URL_TAIL, "");
        if (url !== "") {
          flush();
          spans.push({ text: url, link: url });
          i += url.length;
          continue;
        }
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

/**
 * The end of the run starting at `start`: the longest sequence of list blocks
 * agreeing on `ordered`. This is the unit Docs bullets in one request.
 */
function runEnd(blocks: MarkdownBlock[], start: number): number {
  const first = blocks[start];
  if (first?.kind !== "list") return start + 1;
  let end = start + 1;
  for (;;) {
    const next = blocks[end];
    if (next?.kind !== "list" || next.ordered !== first.ordered) break;
    end += 1;
  }
  return end;
}

/**
 * Assigns ordered runs to Docs lists (decision 0023 §1) and turns the ones that
 * cannot start where they claim back into text (§3).
 *
 * A run joins the open list when its first ordinal is the one the list has
 * reached; only level-0 items advance that count, because a sub-list has its
 * own. Anything but a table may sit between two runs of one list — that is what
 * the native import does, and 0023 §2 is how it is built. A run starting at
 * anything but 1 is not expressible at all, so its ordinals are kept as literal
 * text rather than silently renumbered from 1.
 */
function resolveOrderedRuns(
  blocks: MarkdownBlock[],
  markers: Map<number, string>,
): MarkdownBlock[] {
  const out = [...blocks];
  let expected: number | null = null;

  let i = 0;
  while (i < out.length) {
    const block = out[i];
    if (block === undefined) {
      i += 1;
      continue;
    }
    if (block.kind === "table") {
      expected = null;
      i += 1;
      continue;
    }
    if (block.kind !== "list") {
      i += 1;
      continue;
    }

    const end = runEnd(out, i);
    if (!block.ordered) {
      i = end;
      continue;
    }

    let levelZero = 0;
    for (let k = i; k < end; k += 1) {
      const item = out[k];
      if (item?.kind === "list" && item.level === 0) levelZero += 1;
    }
    const first = block.number ?? 1;

    if (expected !== null && first === expected) {
      out[i] = { ...block, continues: true };
      expected += levelZero;
    } else if (first === 1) {
      expected = 1 + levelZero;
    } else {
      for (let k = i; k < end; k += 1) {
        const item = out[k];
        if (item?.kind !== "list") continue;
        const marker = markers.get(k) ?? `${item.number ?? 1}.`;
        out[k] = { kind: "paragraph", spans: [{ text: `${marker} ` }, ...item.spans] };
      }
      expected = null;
    }
    i = end;
  }
  return out;
}

/** Parses Markdown into blocks Docs can hold. Never throws (decision 0021 §3). */
export function parseMarkdown(source: string): ParsedMarkdown {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  const markers = new Map<number, string>();
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
      const marker = item[2] ?? "";
      const ordinal = ORDERED_MARKER.exec(marker);
      markers.set(blocks.length, marker);
      blocks.push({
        kind: "list",
        ordered: ordinal !== null,
        level: Math.floor(indent / 2),
        ...(ordinal !== null ? { number: Number(ordinal[1]) } : {}),
        spans: inline(item[3] ?? "", number),
      });
      i += 1;
      continue;
    }

    if (HTML_LINE.test(line) && !AUTOLINK.test(line.trimStart())) {
      unsupported.push({ line: number, kind: "html" });
      blocks.push({ kind: "paragraph", spans: [{ text: line.trim() }] });
      i += 1;
      continue;
    }

    blocks.push({ kind: "paragraph", spans: inline(line, number) });
    i += 1;
  }

  return { blocks: resolveOrderedRuns(blocks, markers), unsupported };
}

// --- Block model → Docs requests (decision 0021 §5) --------------------------

const MONOSPACE = "Courier New";
const QUOTE_INDENT_PT = 36;
const BULLET_PRESET = {
  ordered: "NUMBERED_DECIMAL_ALPHA_ROMAN",
  unordered: "BULLET_DISC_CIRCLE_SQUARE",
} as const;

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
 * Character styles for one already-inserted block. Bulleting does not touch
 * them, so they are applied before it.
 */
function textRequests(block: MarkdownBlock, start: number): DocsRequest[] {
  const text = blockText(block);
  if (block.kind === "code") {
    if (text === "") return [];
    return [
      {
        updateTextStyle: {
          range: { startIndex: start, endIndex: start + text.length },
          textStyle: { weightedFontFamily: { fontFamily: MONOSPACE } },
          fields: "weightedFontFamily",
        },
      },
    ];
  }
  if (block.kind === "table") return [];
  return spanRequests(block.spans, start + tabs(block).length);
}

/**
 * Paragraph styles for one already-inserted block. Inside a list run these go
 * last: `createParagraphBullets` applies its own indent over the whole span and
 * `deleteParagraphBullets` clears it again, so anything applied earlier is lost.
 */
function paragraphRequests(block: MarkdownBlock, start: number): DocsRequest[] {
  const paragraph: DocsRange = { startIndex: start, endIndex: start + blockText(block).length + 1 };
  if (block.kind === "heading") {
    return [
      {
        updateParagraphStyle: {
          range: paragraph,
          paragraphStyle: { namedStyleType: `HEADING_${block.level}` },
          fields: "namedStyleType",
        },
      },
    ];
  }
  if (block.kind === "quote") {
    return [
      {
        updateParagraphStyle: {
          range: paragraph,
          paragraphStyle: { indentStart: { magnitude: QUOTE_INDENT_PT, unit: "PT" } },
          fields: "indentStart",
        },
      },
    ];
  }
  return [];
}

/**
 * Requests that style one already-inserted block whose text starts at `start`.
 * List bullets are not here: they are planned per Docs list, because one
 * request per item makes each item its own single-item list and loses both the
 * nesting the tabs encode and the numbering that continues across a run.
 */
function blockRequests(block: MarkdownBlock, start: number): DocsRequest[] {
  return [...textRequests(block, start), ...paragraphRequests(block, start)];
}

export type Segment =
  | { kind: "text"; blocks: MarkdownBlock[] }
  | { kind: "table"; rows: TableRows };

/** Splits blocks at table boundaries: tables are written in their own pass. */
export function toSegments(blocks: MarkdownBlock[]): Segment[] {
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

export interface TextRunPlan {
  requests: DocsRequest[];
  /**
   * Characters the run leaves behind, so the caller knows where the next
   * segment starts. Not the length of the text sent: `createParagraphBullets`
   * deletes the tabs that told it the nesting level.
   */
  length: number;
}

/** The end of the paragraph a block occupies, newline included. */
function paragraphEnd(block: MarkdownBlock, start: number): number {
  return start + blockText(block).length + 1;
}

/**
 * Requests that write a run of non-table blocks at `start` and style them.
 *
 * The text goes in once; every range is then known before the call, because a
 * request's indices are read against the document as of the preceding request.
 * The style units go back to front: `createParagraphBullets` deletes the tabs
 * that told it the nesting level, which moves everything after them.
 */
export function planTextRun(
  blocks: MarkdownBlock[],
  start: number,
  options: { leadingNewline?: boolean } = {},
): TextRunPlan {
  const lead = options.leadingNewline === true ? "\n" : "";
  const lines = blocks.map((block) => `${blockText(block)}\n`);
  const text = lead + lines.join("");
  if (text === "") return { requests: [], length: 0 };

  const starts: number[] = [];
  let offset = start + lead.length;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length;
  }

  const preset = (ordered: boolean) =>
    ordered ? BULLET_PRESET.ordered : BULLET_PRESET.unordered;

  // One unit per block, except that everything belonging to one Docs list is a
  // single unit: its bullets request has to span the whole list for the nesting
  // and the numbering to land (decision 0023 §2).
  const units: { requests: DocsRequest[] }[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    const blockStart = starts[i];
    if (block === undefined || blockStart === undefined) {
      i += 1;
      continue;
    }
    if (block.kind !== "list") {
      units.push({ requests: blockRequests(block, blockStart) });
      i += 1;
      continue;
    }

    // The runs of one Docs list, and the runs of other content between them.
    let end = runEnd(blocks, i);
    const gaps: [number, number][] = [];
    if (block.ordered) {
      let pending: [number, number][] = [];
      let j = end;
      while (j < blocks.length) {
        const next = blocks[j];
        if (next === undefined) break;
        if (next.kind === "list" && next.ordered) {
          if (next.continues !== true) break;
          gaps.push(...pending);
          pending = [];
          end = runEnd(blocks, j);
          j = end;
          continue;
        }
        const gapEnd = next.kind === "list" ? runEnd(blocks, j) : j + 1;
        pending.push([j, gapEnd]);
        j = gapEnd;
      }
    }

    /** Where `position` lands once the span's leading tabs are gone. */
    const adjust = (position: number): number => {
      let removed = 0;
      for (let k = i; k < end; k += 1) {
        const member = blocks[k];
        const memberStart = starts[k];
        if (member === undefined || memberStart === undefined || memberStart >= position) break;
        removed += tabs(member).length;
      }
      return position - removed;
    };
    /** The end of the run `[from, to)`, in post-bullet coordinates. */
    const gapRange = (from: number, to: number): DocsRange | null => {
      const first = starts[from];
      const lastBlock = blocks[to - 1];
      const lastStart = starts[to - 1];
      if (first === undefined || lastBlock === undefined || lastStart === undefined) return null;
      return {
        startIndex: adjust(first),
        endIndex: adjust(paragraphEnd(lastBlock, lastStart)),
      };
    };

    const requests: DocsRequest[] = [];
    for (let k = i; k < end; k += 1) {
      const member = blocks[k];
      const memberStart = starts[k];
      if (member !== undefined && memberStart !== undefined) {
        requests.push(...textRequests(member, memberStart));
      }
    }

    const lastItem = blocks[end - 1];
    const lastStart = starts[end - 1];
    if (lastItem !== undefined && lastStart !== undefined) {
      requests.push({
        createParagraphBullets: {
          range: { startIndex: blockStart, endIndex: paragraphEnd(lastItem, lastStart) },
          bulletPreset: preset(block.ordered),
        },
      });
    }

    // The span above swept the interleaved content into the list. Take it back
    // out, then give a run that is itself a list one of its own.
    for (const [from, to] of gaps) {
      const range = gapRange(from, to);
      if (range !== null) requests.push({ deleteParagraphBullets: { range } });
    }
    for (const [from, to] of gaps) {
      const first = blocks[from];
      const range = first?.kind === "list" ? gapRange(from, to) : null;
      if (first?.kind === "list" && range !== null) {
        requests.push({ createParagraphBullets: { range, bulletPreset: preset(first.ordered) } });
      }
    }
    for (const [from, to] of gaps) {
      for (let k = from; k < to; k += 1) {
        const member = blocks[k];
        const memberStart = starts[k];
        if (member !== undefined && memberStart !== undefined) {
          requests.push(...paragraphRequests(member, adjust(memberStart)));
        }
      }
    }

    units.push({ requests });
    i = end;
  }

  const requests: DocsRequest[] = [{ insertText: { location: { index: start }, text } }];
  for (let u = units.length - 1; u >= 0; u -= 1) requests.push(...(units[u]?.requests ?? []));
  const tabsRemoved = blocks.reduce((sum, block) => sum + tabs(block).length, 0);
  return { requests, length: text.length - tabsRemoved };
}

/** The request that creates an empty table at `index`, or null for no table. */
export function planTable(rows: TableRows, index: number): DocsRequest | null {
  const columns = rows[0]?.length ?? 0;
  if (rows.length === 0 || columns === 0) return null;
  return { insertTable: { location: { index }, rows: rows.length, columns } };
}

export interface CellFillPlan {
  requests: DocsRequest[];
  /** Characters added to the table, so the caller can advance past it. */
  added: number;
}

/**
 * Fills a just-created table from the indices the API reported for its cells.
 * Descending throughout: writing into an earlier cell moves every later one.
 */
export function planCellFills(table: TableRaw, rows: TableRows): CellFillPlan {
  const requests: DocsRequest[] = [];
  const rawRows = table.tableRows ?? [];
  let added = 0;

  for (let r = rawRows.length - 1; r >= 0; r -= 1) {
    const cells = rawRows[r]?.tableCells ?? [];
    for (let c = cells.length - 1; c >= 0; c -= 1) {
      const spans = rows[r]?.[c] ?? [];
      const text = spanText(spans);
      const start = cells[c]?.content?.[0]?.startIndex;
      if (text === "" || typeof start !== "number") continue;
      requests.push({ insertText: { location: { index: start }, text } });
      requests.push(...spanRequests(spans, start));
      added += text.length;
    }
  }
  return { requests, added };
}
