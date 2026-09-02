import { mapDriveError as mapApiError } from "./api.ts";
import {
  asDocsStoresIt,
  LINE_BREAK,
  parseMarkdown,
  planCellFills,
  planTable,
  planTextRun,
  resetParagraphStyle,
  resetTextStyle,
  toSegments,
  type UnsupportedNote,
} from "./markdown-doc.ts";

// --- Raw Docs v1 shapes (only the fields we read) ---------------------------

export interface TextStyleRaw {
  bold?: boolean | null;
  italic?: boolean | null;
  link?: { url?: string | null } | null;
}

export interface TextRunRaw {
  content?: string | null;
  textStyle?: TextStyleRaw | null;
}

export interface ParagraphElementRaw {
  startIndex?: number | null;
  textRun?: TextRunRaw | null;
}

export interface ParagraphRaw {
  elements?: ParagraphElementRaw[] | null;
  paragraphStyle?: { namedStyleType?: string | null } | null;
  bullet?: { listId?: string | null; nestingLevel?: number | null } | null;
}

export interface TableCellRaw {
  content?: StructuralElementRaw[] | null;
}

export interface TableRaw {
  tableRows?: { tableCells?: TableCellRaw[] | null }[] | null;
}

export interface StructuralElementRaw {
  startIndex?: number | null;
  endIndex?: number | null;
  paragraph?: ParagraphRaw | null;
  table?: TableRaw | null;
}

export interface NestingLevelRaw {
  glyphType?: string | null;
  glyphFormat?: string | null;
  glyphSymbol?: string | null;
  /** Where an ordered level starts counting; read-only in the API (0023 §3). */
  startNumber?: number | null;
}

export interface ListRaw {
  listProperties?: { nestingLevels?: NestingLevelRaw[] | null } | null;
}

/** A header, footer or footnote: a content array with an index space of its own. */
export interface SegmentRaw {
  content?: StructuralElementRaw[] | null;
}

export interface DocumentRaw {
  documentId?: string | null;
  title?: string | null;
  body?: { content?: StructuralElementRaw[] | null } | null;
  /**
   * The three keyed segment maps (decision 0064 §1). Each key is the segment id
   * every `Location` and `Range` in that segment has to carry — index 42 in the
   * body and index 42 in a footer are different characters, which is why §2
   * makes the id part of a range rather than something a caller assumes.
   */
  headers?: Record<string, SegmentRaw> | null;
  footers?: Record<string, SegmentRaw> | null;
  footnotes?: Record<string, SegmentRaw> | null;
  lists?: Record<string, ListRaw> | null;
}

/** What a segment is called where a document shows one, and in `read`'s output. */
export type SegmentKind = "body" | "header" | "footer" | "footnote";

/** One of a document's index spaces: the body, or one keyed segment. */
export interface Segment {
  kind: SegmentKind;
  /** Absent for the body, which the API addresses by omitting the field. */
  id?: string;
  content: StructuralElementRaw[];
}

/**
 * Every segment that holds text, body first (decision 0064 §1).
 *
 * Order is what makes "matches exactly once" reproducible: a marker's ranges
 * come back in a stable sequence whatever the API's key order was, so the count
 * a caller is refused with does not move between runs.
 */
export function segmentsOf(document: DocumentRaw): Segment[] {
  const segments: Segment[] = [{ kind: "body", content: document.body?.content ?? [] }];
  const keyed: [SegmentKind, Record<string, SegmentRaw> | null | undefined][] = [
    ["header", document.headers],
    ["footer", document.footers],
    ["footnote", document.footnotes],
  ];
  for (const [kind, map] of keyed) {
    for (const id of Object.keys(map ?? {}).sort()) {
      segments.push({ kind, id, content: map?.[id]?.content ?? [] });
    }
  }
  return segments;
}

export interface DocsRange {
  startIndex: number;
  endIndex: number;
  /**
   * Which index space this range belongs to; absent means the body, which is
   * how the API spells it too (decision 0064 §2).
   */
  segmentId?: string;
}

/** The write half of a text style; only the fields we set (decision 0021). */
export interface DocsTextStyleWrite {
  bold?: boolean;
  italic?: boolean;
  link?: { url: string };
  weightedFontFamily?: { fontFamily: string };
}

export interface DocsParagraphStyleWrite {
  namedStyleType?: string;
  indentStart?: { magnitude: number; unit: "PT" };
}

/** Where a request acts. `segmentId` absent is the body, as the API has it. */
export interface DocsLocation {
  index: number;
  segmentId?: string;
}

export type DocsRequest =
  | { insertText: { location: DocsLocation; text: string } }
  | {
      replaceAllText: {
        containsText: { text: string; matchCase: boolean };
        replaceText: string;
      };
    }
  | { deleteContentRange: { range: DocsRange } }
  | { insertTable: { location: DocsLocation; rows: number; columns: number } }
  | { updateTextStyle: { range: DocsRange; textStyle: DocsTextStyleWrite; fields: string } }
  | {
      updateParagraphStyle: {
        range: DocsRange;
        paragraphStyle: DocsParagraphStyleWrite;
        fields: string;
      };
    }
  | { createParagraphBullets: { range: DocsRange; bulletPreset: string } }
  | { deleteParagraphBullets: { range: DocsRange } };

export interface DocsReply {
  replaceAllText?: { occurrencesChanged?: number | null } | null;
}

/**
 * Minimal abstraction over `google.docs({version:"v1"}).documents` for
 * testability (decision 0012).
 */
export interface DocsClient {
  documents: {
    get: (params: { documentId: string }) => Promise<{ data: DocumentRaw }>;
    create: (params: { requestBody: { title: string } }) => Promise<{ data: DocumentRaw }>;
    batchUpdate: (params: {
      documentId: string;
      requestBody: { requests: DocsRequest[] };
    }) => Promise<{ data: { replies?: DocsReply[] | null } }>;
  };
}

// --- Rendering (decision 0009) ----------------------------------------------

export type DocsRenderFormat = "markdown" | "text";

const ORDERED_GLYPHS = new Set([
  "DECIMAL",
  "ZERO_DECIMAL",
  "UPPER_ALPHA",
  "ALPHA",
  "UPPER_ROMAN",
  "ROMAN",
]);

/** Applies bold/italic/link markers, keeping surrounding spaces outside them. */
function styleRun(raw: string, style: TextStyleRaw): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
  if (!match) return raw;
  const [, lead = "", core = "", trail = ""] = match;
  if (core === "") return raw;
  let styled = core;
  if (style.bold) styled = `**${styled}**`;
  if (style.italic) styled = `*${styled}*`;
  if (style.link?.url) styled = `[${styled}](${style.link.url})`;
  return lead + styled + trail;
}

function inlineMarkdown(elements: ParagraphElementRaw[]): string {
  let out = "";
  for (const element of elements) {
    const run = element.textRun;
    if (!run) continue;
    // Docs terminates each paragraph's last run with a newline.
    const raw = (run.content ?? "").replace(/\n$/, "");
    if (raw === "") continue;
    out += styleRun(raw, run.textStyle ?? {});
  }
  return out;
}

/**
 * True when a list level is numbered. Docs reports this three different ways
 * and sometimes not at all — documents converted from HTML come back with
 * `GLYPH_TYPE_UNSPECIFIED` and no glyph fields, which falls back to a bullet.
 */
function isOrderedLevel(level: NestingLevelRaw | undefined): boolean {
  if (!level) return false;
  if (level.glyphType && ORDERED_GLYPHS.has(level.glyphType)) return true;
  if (level.glyphSymbol) return false;
  // A numbered format interpolates the count, e.g. "%0." or "%0.%1".
  return level.glyphFormat !== undefined && level.glyphFormat !== null
    ? level.glyphFormat.includes("%0")
    : false;
}

/**
 * Counts the items of each ordered list as they are rendered (decision 0023
 * §5). A numbered item's ordinal is its position within its list, so the count
 * has to be kept while walking the body; printing `1.` for every item is what
 * made a list continued across other content indistinguishable from a series of
 * separate ones. A deeper level restarts whenever a shallower item advances,
 * which is how Docs numbers a sub-list.
 */
function makeOrdinals(): (listId: string, level: number, from: number) => number {
  const counters = new Map<string, (number | undefined)[]>();
  return (listId, level, from) => {
    const levels = counters.get(listId) ?? [];
    const current = levels[level];
    const value = current === undefined ? from : current + 1;
    levels[level] = value;
    for (let deeper = level + 1; deeper < levels.length; deeper += 1) levels[deeper] = undefined;
    counters.set(listId, levels);
    return value;
  };
}

/** Heading / list marker for a paragraph, or "" for body text. */
function paragraphPrefix(
  paragraph: ParagraphRaw,
  lists: Record<string, ListRaw>,
  ordinal: (listId: string, level: number, from: number) => number,
): string {
  const bullet = paragraph.bullet;
  if (bullet) {
    const level = bullet.nestingLevel ?? 0;
    const listId = bullet.listId ?? "";
    const nesting = lists[listId]?.listProperties?.nestingLevels?.[level];
    if (!isOrderedLevel(nesting)) return `${"  ".repeat(level)}- `;
    // The API treats a start of 0 as 1.
    const start = nesting?.startNumber ?? 1;
    return `${"  ".repeat(level)}${ordinal(listId, level, start > 0 ? start : 1)}. `;
  }
  const style = paragraph.paragraphStyle?.namedStyleType ?? "";
  const heading = /^HEADING_([1-6])$/.exec(style);
  if (heading) return "#".repeat(Number(heading[1])) + " ";
  if (style === "TITLE") return "# ";
  if (style === "SUBTITLE") return "## ";
  return "";
}

function cellMarkdown(cell: TableCellRaw): string {
  return (cell.content ?? [])
    .map((el) => (el.paragraph ? inlineMarkdown(el.paragraph.elements ?? []) : ""))
    .filter((s) => s !== "")
    .join(" ");
}

/** Best-effort pipe table; Docs table structure is otherwise out of scope (0009). */
function markdownTable(table: TableRaw): string {
  const rows = (table.tableRows ?? []).map((row) => (row.tableCells ?? []).map(cellMarkdown));
  const first = rows[0];
  if (!first) return "";
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const separator = line(first.map(() => "---"));
  return [line(first), separator, ...rows.slice(1).map(line)].join("\n");
}

function plainText(content: StructuralElementRaw[]): string {
  let out = "";
  for (const element of content) {
    if (element.paragraph) {
      for (const el of element.paragraph.elements ?? []) out += el.textRun?.content ?? "";
    } else if (element.table) {
      for (const row of element.table.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) out += plainText(cell.content ?? []);
      }
    }
  }
  return out;
}

/**
 * Spells Docs' in-paragraph line breaks as CommonMark hard breaks (0024 §1).
 * Trailing spaces go with them: they are invisible, and left in place they
 * would read back as a break of their own.
 */
function hardBreaks(block: string): string {
  return block
    .split(LINE_BREAK)
    .map((line) => line.replace(/ +$/, ""))
    .join("\\\n");
}

/** Renders a document body as Markdown or plain text (decision 0009). */
export function renderDocument(document: DocumentRaw, as: DocsRenderFormat): string {
  const segments = segmentsOf(document);
  const lists = document.lists ?? {};
  const rendered: string[] = [];

  for (const segment of segments) {
    const one =
      as === "text"
        ? plainText(segment.content).replaceAll(LINE_BREAK, "\n").replace(/\n+$/, "")
        : renderSegment(segment.content, lists);
    // A segment the document does not have, or has empty, is not a heading with
    // nothing under it.
    if (one === "" && segment.kind !== "body") continue;
    rendered.push(segment.kind === "body" ? one : `${segmentHeading(segment)}\n${one}`);
  }
  return rendered.join("\n\n").replace(/\n+$/, "");
}

/**
 * How `read` names a segment, and the only place its id is shown.
 *
 * A marker is what addresses content (decision 0064 §3), so this is a label
 * rather than a handle — but the id is here because a document with two headers
 * has to be distinguishable, and because it is what a `Location` carries.
 */
function segmentHeading(segment: Segment): string {
  return `<!-- ${segment.kind}: ${segment.id ?? ""} -->`;
}

function renderSegment(content: StructuralElementRaw[], lists: Record<string, ListRaw>): string {
  const ordinal = makeOrdinals();
  const blocks: string[] = [];
  for (const element of content) {
    if (element.paragraph) {
      const paragraph = element.paragraph;
      blocks.push(
        hardBreaks(
          paragraphPrefix(paragraph, lists, ordinal) + inlineMarkdown(paragraph.elements ?? []),
        ),
      );
    } else if (element.table) {
      blocks.push(markdownTable(element.table));
    }
  }
  return blocks.join("\n").replace(/\n+$/, "");
}

/**
 * Insertion index for the end of the body. Docs reserves the final newline of
 * the last segment, so appends target `endIndex - 1`.
 */
export function endOfBody(document: DocumentRaw): number {
  const content = document.body?.content ?? [];
  const last = content[content.length - 1];
  const end = last?.endIndex;
  return typeof end === "number" && end > 1 ? end - 1 : 1;
}

// --- Wrapper operations -----------------------------------------------------

export async function getDocument(client: DocsClient, documentId: string): Promise<DocumentRaw> {
  try {
    const res = await client.documents.get({ documentId });
    return res.data;
  } catch (error) {
    mapApiError(error);
  }
}

export async function createDocument(
  client: DocsClient,
  title: string,
): Promise<{ id: string; title: string }> {
  try {
    const res = await client.documents.create({ requestBody: { title } });
    return { id: res.data.documentId ?? "", title: res.data.title ?? title };
  } catch (error) {
    mapApiError(error);
  }
}

/**
 * What the insertion point is bounded by (decision 0045 §2). Docs copies the
 * paragraph style of a paragraph it splits, so an insert may only reset the
 * paragraphs it wholly created — and whether the first and last are among them
 * is a fact about the document at that index, not about the payload.
 */
export interface ParagraphBoundary {
  /** Nothing of a paragraph precedes the index, so an insert opens one of its own. */
  atParagraphStart: boolean;
  /** The index is a paragraph's own newline, so an insert closes one of its own. */
  atParagraphEnd: boolean;
}

const INSIDE_A_PARAGRAPH: ParagraphBoundary = { atParagraphStart: false, atParagraphEnd: false };

/**
 * The end of the paragraph `index` falls at the end of, or `index` unchanged.
 *
 * A marker range ends at the last character of the matched text. When that is
 * also the paragraph's last character, the paragraph's newline sits one place
 * further on — and a deletion that stops short of it leaves an empty paragraph
 * where the text was, which is the defect issue #41 reports about an empty
 * `--replace` (decision 0062 §3).
 */
export function paragraphEnd(document: DocumentRaw, index: number, segmentId?: string): number {
  for (const element of contentOfSegment(document, segmentId)) {
    if (!element.paragraph) continue;
    if (element.endIndex === index + 1) return element.endIndex;
  }
  return index;
}

/** One segment's content, by the id a range carries (decision 0064 §2). */
export function contentOfSegment(
  document: DocumentRaw,
  segmentId: string | undefined,
): StructuralElementRaw[] {
  const found = segmentsOf(document).find((segment) => segment.id === segmentId);
  return found?.content ?? [];
}

/**
 * Puts every request in one segment (decision 0064 §2).
 *
 * The Markdown builders compose a list of `Location`s and `Range`s against a
 * single index space and know nothing about segments; stamping the id on the
 * way out keeps that true, and means one place decides rather than a dozen.
 * The body is spelled by leaving the field off, which is what the API does.
 */
export function inSegment(requests: DocsRequest[], segmentId: string | undefined): DocsRequest[] {
  if (segmentId === undefined || segmentId === "") return requests;
  return requests.map((request) => {
    if ("insertText" in request) {
      return {
        insertText: {
          ...request.insertText,
          location: { ...request.insertText.location, segmentId },
        },
      };
    }
    if ("insertTable" in request) {
      return {
        insertTable: {
          ...request.insertTable,
          location: { ...request.insertTable.location, segmentId },
        },
      };
    }
    if ("deleteContentRange" in request) {
      return { deleteContentRange: { range: { ...request.deleteContentRange.range, segmentId } } };
    }
    if ("updateTextStyle" in request) {
      return {
        updateTextStyle: {
          ...request.updateTextStyle,
          range: { ...request.updateTextStyle.range, segmentId },
        },
      };
    }
    if ("updateParagraphStyle" in request) {
      return {
        updateParagraphStyle: {
          ...request.updateParagraphStyle,
          range: { ...request.updateParagraphStyle.range, segmentId },
        },
      };
    }
    if ("createParagraphBullets" in request) {
      return {
        createParagraphBullets: {
          ...request.createParagraphBullets,
          range: { ...request.createParagraphBullets.range, segmentId },
        },
      };
    }
    if ("deleteParagraphBullets" in request) {
      return {
        deleteParagraphBullets: { range: { ...request.deleteParagraphBullets.range, segmentId } },
      };
    }
    // `replaceAllText` has no segment: it covers all of them by design, which
    // is the reach decision 0046 kept and 0064 §4 finally matches everywhere.
    return request;
  });
}

/** Reads the boundary at `index` from a document the caller already has. */
export function paragraphBoundary(
  document: DocumentRaw,
  index: number,
  segmentId?: string,
): ParagraphBoundary {
  let atParagraphStart = false;
  let atParagraphEnd = false;
  for (const element of contentOfSegment(document, segmentId)) {
    if (!element.paragraph) continue;
    if (element.startIndex === index) atParagraphStart = true;
    if (element.endIndex === index + 1) atParagraphEnd = true;
  }
  return { atParagraphStart, atParagraphEnd };
}

/**
 * The blank slate for a literal insert (decision 0045 §1, §3). The characters
 * are exactly ours, so their style always resets; a paragraph is ours only when
 * our own newlines bound it, or the index did.
 */
function literalResetRequests(
  index: number,
  text: string,
  boundary: ParagraphBoundary,
): DocsRequest[] {
  if (text === "") return [];
  const requests = [resetTextStyle({ startIndex: index, endIndex: index + text.length })];

  // The first paragraph the insert filled is its own when the index opened one,
  // and otherwise starts after the payload's first newline; the last is its own
  // when the index closed one, and otherwise ends at the payload's last.
  const past = (breakAt: number): number | null => (breakAt === -1 ? null : index + breakAt + 1);
  const from = boundary.atParagraphStart ? index : past(text.indexOf("\n"));
  const to = boundary.atParagraphEnd ? index + text.length : past(text.lastIndexOf("\n"));
  if (from !== null && to !== null && from < to) {
    requests.push(...resetParagraphStyle({ startIndex: from, endIndex: to }));
  }
  return requests;
}

/**
 * Inserts `text` at a 1-based character index in the body, in the default style.
 *
 * What is sent is `text` as Docs would have stored it: the reset ranges are
 * measured in characters, and a character the API drops on the way in would
 * push every one of them past what it was meant to name. `--as text` is where
 * that bites — a CRLF log is what the flag is for.
 */
export async function insertText(
  client: DocsClient,
  documentId: string,
  index: number,
  raw: string,
  boundary: ParagraphBoundary = INSIDE_A_PARAGRAPH,
  segmentId?: string,
): Promise<void> {
  const text = asDocsStoresIt(raw);
  if (text === "") return;
  try {
    await client.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: inSegment(
          [
            { insertText: { location: { index }, text } },
            ...literalResetRequests(index, text, boundary),
          ],
          segmentId,
        ),
      },
    });
  } catch (error) {
    mapApiError(error);
  }
}

/** Replaces every occurrence of `find`; returns how many were changed. */
export async function replaceAllText(
  client: DocsClient,
  documentId: string,
  find: string,
  replace: string,
  matchCase: boolean,
): Promise<number> {
  try {
    const res = await client.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            replaceAllText: {
              containsText: { text: find, matchCase },
              replaceText: replace,
            },
          },
        ],
      },
    });
    return res.data.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0;
  } catch (error) {
    mapApiError(error);
  }
}

// --- Markdown writes (decision 0021) ----------------------------------------

async function applyRequests(
  client: DocsClient,
  documentId: string,
  requests: DocsRequest[],
): Promise<void> {
  if (requests.length === 0) return;
  try {
    await client.documents.batchUpdate({ documentId, requestBody: { requests } });
  } catch (error) {
    mapApiError(error);
  }
}

/** The first table at or after `index`, which is the one we just created. */
function tableAt(
  document: DocumentRaw,
  index: number,
  segmentId: string | undefined,
): StructuralElementRaw | null {
  for (const element of contentOfSegment(document, segmentId)) {
    if (element.table && (element.startIndex ?? 0) >= index) return element;
  }
  return null;
}

/**
 * Writes Markdown `source` at a 1-based index, returning what Docs could not
 * hold.
 *
 * Segments are written **forward**, each at the cursor the previous one left.
 * Writing them backwards at a fixed anchor would need no arithmetic, but
 * inserting at a paragraph's start index merges into that paragraph, so its
 * style — a heading, a quote's indent, a bullet — would spread over everything
 * inserted before it afterwards.
 *
 * A payload without a table is still one round trip. A table costs a re-read:
 * its cells' indices are the API's to decide, and guessing them writes cell
 * text into the wrong cell — a failure that looks like success (0021 §5).
 */
export async function insertMarkdown(
  client: DocsClient,
  documentId: string,
  index: number,
  source: string,
  options: { leadingNewline?: boolean; boundary?: ParagraphBoundary; segmentId?: string } = {},
): Promise<UnsupportedNote[]> {
  const { segmentId } = options;
  const { blocks, unsupported } = parseMarkdown(source);
  let cursor = index;
  let leadingNewline = options.leadingNewline === true;
  let pending: DocsRequest[] = [];
  let first = true;

  for (const segment of toSegments(blocks)) {
    // Only the first segment can land inside a paragraph that was already
    // there; every later one starts where the segment before it left off, which
    // is a paragraph of this write's own making (decision 0045 §2).
    const firstParagraphIsNew = !first || options.boundary?.atParagraphStart === true;
    first = false;

    if (segment.kind === "text") {
      const plan = planTextRun(segment.blocks, cursor, { leadingNewline, firstParagraphIsNew });
      pending.push(...plan.requests);
      cursor += plan.length;
      leadingNewline = false;
      continue;
    }

    if (leadingNewline) {
      pending.push({ insertText: { location: { index: cursor }, text: "\n" } });
      cursor += 1;
      leadingNewline = false;
    }
    const create = planTable(segment.rows, cursor);
    if (create === null) continue;

    pending.push(create);
    await applyRequests(client, documentId, inSegment(pending, segmentId));
    pending = [];

    const element = tableAt(await getDocument(client, documentId), cursor, segmentId);
    if (element?.table === undefined || element.table === null) continue;
    const fills = planCellFills(element.table, segment.rows);
    await applyRequests(client, documentId, inSegment(fills.requests, segmentId));
    cursor = (element.endIndex ?? cursor) + fills.added;
  }

  await applyRequests(client, documentId, inSegment(pending, segmentId));
  return unsupported;
}

/** Removes a range of the body (decision 0062 §1). */
export async function deleteRange(
  client: DocsClient,
  documentId: string,
  range: DocsRange,
): Promise<void> {
  await applyRequests(client, documentId, [{ deleteContentRange: { range } }]);
}

/**
 * Ranges of `marker` in every segment that holds text, in document order —
 * the body first, then headers, footers and footnotes (decision 0064 §1).
 * Table cells are skipped: the replacement may itself be a table, and Docs
 * cannot nest one (decision 0021 §6).
 *
 * **A marker in the body and in a header matches twice.** That is 0064 §2's
 * point and the breaking half of it: an `insert --before` that used to take the
 * body one is now refused, because choosing between two segments silently is
 * choosing for the caller.
 */
export function findMarkerRanges(
  document: DocumentRaw,
  marker: string,
  matchCase: boolean,
): DocsRange[] {
  return segmentsOf(document).flatMap((segment) => markerRangesIn(segment, marker, matchCase));
}

function markerRangesIn(segment: Segment, marker: string, matchCase: boolean): DocsRange[] {
  if (marker === "") return [];
  const fold = (s: string) => (matchCase ? s : s.toLowerCase());
  const needle = fold(marker);
  const ranges: DocsRange[] = [];

  for (const element of segment.content) {
    const paragraph = element.paragraph;
    if (!paragraph) continue;

    // Paragraph text alongside the Docs index of each of its characters.
    //
    // An absent `startIndex` means **0**, not 1. The body starts at 1 and Docs
    // always sends that; a header, footer or footnote starts at 0, and Docs
    // omits a zero from the JSON — so defaulting to 1 shifts every index in a
    // segment by one and a delete leaves the first character behind. Measured
    // against a real header before this line said 0 (decision 0064 §2).
    let text = "";
    const indices: number[] = [];
    let cursor = element.startIndex ?? 0;
    for (const el of paragraph.elements ?? []) {
      const start = el.startIndex ?? cursor;
      const content = el.textRun?.content ?? "";
      for (let k = 0; k < content.length; k += 1) {
        text += content[k];
        indices.push(start + k);
      }
      cursor = start + content.length;
    }

    const haystack = fold(text);
    let at = haystack.indexOf(needle);
    while (at !== -1) {
      const startIndex = indices[at];
      const endIndex = indices[at + needle.length - 1];
      if (startIndex !== undefined && endIndex !== undefined) {
        ranges.push({
          startIndex,
          endIndex: endIndex + 1,
          ...(segment.id === undefined ? {} : { segmentId: segment.id }),
        });
      }
      at = haystack.indexOf(needle, at + needle.length);
    }
  }
  return ranges;
}

/**
 * Replaces every occurrence of `find` with Markdown structure. `replaceAllText`
 * can only substitute text for text, so each occurrence is deleted and rewritten
 * — last to first, so an earlier edit never moves a later target (0021 §6).
 */
export async function replaceMarkdown(
  client: DocsClient,
  documentId: string,
  find: string,
  source: string,
  matchCase: boolean,
): Promise<{ replaced: number; unsupported: UnsupportedNote[] }> {
  const document = await getDocument(client, documentId);
  const ranges = findMarkerRanges(document, find, matchCase);
  let unsupported: UnsupportedNote[] = [];

  for (const range of [...ranges].reverse()) {
    // Read at the marker's own edges: once it is gone, what followed it sits at
    // its start, so that is where the replacement's last paragraph ends.
    const { segmentId } = range;
    const boundary: ParagraphBoundary = {
      atParagraphStart: paragraphBoundary(document, range.startIndex, segmentId).atParagraphStart,
      atParagraphEnd: paragraphBoundary(document, range.endIndex, segmentId).atParagraphEnd,
    };
    await applyRequests(client, documentId, [{ deleteContentRange: { range } }]);
    unsupported = await insertMarkdown(client, documentId, range.startIndex, source, {
      boundary,
      ...(segmentId === undefined ? {} : { segmentId }),
    });
  }
  return { replaced: ranges.length, unsupported };
}
