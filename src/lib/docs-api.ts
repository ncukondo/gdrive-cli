import { mapDriveError as mapApiError } from "./api.ts";

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

export interface ListRaw {
  listProperties?: { nestingLevels?: { glyphType?: string | null }[] | null } | null;
}

export interface DocumentRaw {
  documentId?: string | null;
  title?: string | null;
  body?: { content?: StructuralElementRaw[] | null } | null;
  lists?: Record<string, ListRaw> | null;
}

export type DocsRequest =
  | { insertText: { location: { index: number }; text: string } }
  | {
      replaceAllText: {
        containsText: { text: string; matchCase: boolean };
        replaceText: string;
      };
    };

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

/** Heading / list marker for a paragraph, or "" for body text. */
function paragraphPrefix(paragraph: ParagraphRaw, lists: Record<string, ListRaw>): string {
  const bullet = paragraph.bullet;
  if (bullet) {
    const level = bullet.nestingLevel ?? 0;
    const glyph =
      lists[bullet.listId ?? ""]?.listProperties?.nestingLevels?.[level]?.glyphType ?? "";
    return "  ".repeat(level) + (ORDERED_GLYPHS.has(glyph) ? "1. " : "- ");
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
