/**
 * Markdown → document model (decision 0021).
 *
 * The subset is the one `renderDocument` emits (0009), so the pair round-trips;
 * everything else still lands rather than being refused (0021 §3). One source
 * line is one block: `read` separates blocks with a single newline, so merging
 * soft-wrapped lines the way CommonMark does would fuse paragraphs that came
 * back apart.
 */

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
