import { mapDriveError as mapApiError } from "./api.ts";
import {
  parseMarkdown,
  planCellFills,
  planTable,
  planTextRun,
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
}

export interface ListRaw {
  listProperties?: { nestingLevels?: NestingLevelRaw[] | null } | null;
}

export interface DocumentRaw {
  documentId?: string | null;
  title?: string | null;
  body?: { content?: StructuralElementRaw[] | null } | null;
  lists?: Record<string, ListRaw> | null;
}

export interface DocsRange {
  startIndex: number;
  endIndex: number;
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

export type DocsRequest =
  | { insertText: { location: { index: number }; text: string } }
  | {
      replaceAllText: {
        containsText: { text: string; matchCase: boolean };
        replaceText: string;
      };
    }
  | { deleteContentRange: { range: DocsRange } }
  | { insertTable: { location: { index: number }; rows: number; columns: number } }
  | { updateTextStyle: { range: DocsRange; textStyle: DocsTextStyleWrite; fields: string } }
  | {
      updateParagraphStyle: {
        range: DocsRange;
        paragraphStyle: DocsParagraphStyleWrite;
        fields: string;
      };
    }
  | { createParagraphBullets: { range: DocsRange; bulletPreset: string } };

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

/** Heading / list marker for a paragraph, or "" for body text. */
function paragraphPrefix(paragraph: ParagraphRaw, lists: Record<string, ListRaw>): string {
  const bullet = paragraph.bullet;
  if (bullet) {
    const level = bullet.nestingLevel ?? 0;
    const nesting = lists[bullet.listId ?? ""]?.listProperties?.nestingLevels?.[level];
    return "  ".repeat(level) + (isOrderedLevel(nesting) ? "1. " : "- ");
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

/** Renders a document body as Markdown or plain text (decision 0009). */
export function renderDocument(document: DocumentRaw, as: DocsRenderFormat): string {
  const content = document.body?.content ?? [];
  if (as === "text") return plainText(content).replace(/\n+$/, "");

  const lists = document.lists ?? {};
  const blocks: string[] = [];
  for (const element of content) {
    if (element.paragraph) {
      const paragraph = element.paragraph;
      blocks.push(paragraphPrefix(paragraph, lists) + inlineMarkdown(paragraph.elements ?? []));
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

/** Inserts `text` at a 1-based character index in the body. */
export async function insertText(
  client: DocsClient,
  documentId: string,
  index: number,
  text: string,
): Promise<void> {
  try {
    await client.documents.batchUpdate({
      documentId,
      requestBody: { requests: [{ insertText: { location: { index }, text } }] },
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
function tableAt(document: DocumentRaw, index: number): StructuralElementRaw | null {
  for (const element of document.body?.content ?? []) {
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
  options: { leadingNewline?: boolean } = {},
): Promise<UnsupportedNote[]> {
  const { blocks, unsupported } = parseMarkdown(source);
  let cursor = index;
  let leadingNewline = options.leadingNewline === true;
  let pending: DocsRequest[] = [];

  for (const segment of toSegments(blocks)) {
    if (segment.kind === "text") {
      const plan = planTextRun(segment.blocks, cursor, { leadingNewline });
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
    await applyRequests(client, documentId, pending);
    pending = [];

    const element = tableAt(await getDocument(client, documentId), cursor);
    if (element?.table === undefined || element.table === null) continue;
    const fills = planCellFills(element.table, segment.rows);
    await applyRequests(client, documentId, fills.requests);
    cursor = (element.endIndex ?? cursor) + fills.added;
  }

  await applyRequests(client, documentId, pending);
  return unsupported;
}

/**
 * Ranges of `marker` in the body's paragraphs, in document order. Table cells
 * are skipped: the replacement may itself be a table, and Docs cannot nest one
 * (decision 0021 §6).
 */
export function findMarkerRanges(
  document: DocumentRaw,
  marker: string,
  matchCase: boolean,
): DocsRange[] {
  if (marker === "") return [];
  const fold = (s: string) => (matchCase ? s : s.toLowerCase());
  const needle = fold(marker);
  const ranges: DocsRange[] = [];

  for (const element of document.body?.content ?? []) {
    const paragraph = element.paragraph;
    if (!paragraph) continue;

    // Paragraph text alongside the Docs index of each of its characters.
    let text = "";
    const indices: number[] = [];
    let cursor = element.startIndex ?? 1;
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
        ranges.push({ startIndex, endIndex: endIndex + 1 });
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
    await applyRequests(client, documentId, [{ deleteContentRange: { range } }]);
    unsupported = await insertMarkdown(client, documentId, range.startIndex, source);
  }
  return { replaced: ranges.length, unsupported };
}
