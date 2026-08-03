import { z } from "zod";
import { MAX_PAGES, mapDriveError as mapApiError } from "./api.ts";
import { choiceTypeOf } from "./form-document.ts";
import type { FormDocument, FormRaw } from "./form-document.ts";

/**
 * The Forms v1 client port and the response join (decision 0027 §6).
 *
 * The raw *form* shapes live in `form-document.ts` next to the projection that
 * consumes them; what is here is the client and the shapes only responses use.
 */

// --- Raw Forms v1 response shapes (only the fields we read) -----------------

export interface TextAnswerRaw {
  value?: string | null;
}

export interface FileUploadAnswerRaw {
  fileId?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
}

export interface AnswerRaw {
  questionId?: string | null;
  textAnswers?: { answers?: TextAnswerRaw[] };
  fileUploadAnswers?: { answers?: FileUploadAnswerRaw[] };
  /** Quiz grades are read from the API but not projected (decision 0027). */
  grade?: unknown;
}

export interface FormResponseRaw {
  responseId?: string | null;
  createTime?: string | null;
  lastSubmittedTime?: string | null;
  respondentEmail?: string | null;
  totalScore?: number | null;
  answers?: { [questionId: string]: AnswerRaw } | null;
}

export interface ListResponsesRaw {
  responses?: FormResponseRaw[];
  nextPageToken?: string | null;
}

export interface ListResponsesParams {
  formId: string;
  pageToken?: string;
}

/**
 * Minimal abstraction over `google.forms({version:"v1"}).forms` for
 * testability (decision 0012).
 */
export interface FormsClient {
  forms: {
    get: (params: { formId: string }) => Promise<{ data: FormRaw }>;
    responses: {
      list: (params: ListResponsesParams) => Promise<{ data: ListResponsesRaw }>;
    };
  };
}

// --- Wrapper operations -----------------------------------------------------

export async function getForm(client: FormsClient, formId: string): Promise<FormRaw> {
  try {
    const res = await client.forms.get({ formId });
    return res.data;
  } catch (error) {
    mapApiError(error);
  }
}

/** Every response to a form, following `nextPageToken` to the last page. */
export async function listResponses(
  client: FormsClient,
  formId: string,
): Promise<FormResponseRaw[]> {
  const responses: FormResponseRaw[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  try {
    do {
      const params: ListResponsesParams = { formId };
      if (pageToken !== undefined) params.pageToken = pageToken;
      const res = await client.forms.responses.list(params);
      responses.push(...(res.data.responses ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
      pages += 1;
    } while (pageToken !== undefined && pages < MAX_PAGES);
  } catch (error) {
    mapApiError(error);
  }
  return responses;
}

// --- The response table (decision 0027 §6) ----------------------------------

/** The one column that is not a question. */
export const SUBMITTED_COLUMN = "submitted";

export interface ResponseColumn {
  title: string;
  /** `null` for {@link SUBMITTED_COLUMN}. */
  question_id: string | null;
  /** Checkbox and file-upload answers are several values (decision 0027 §6). */
  multi: boolean;
}

/** A cell: an array for a multi-valued column, a string for every other. */
export type ResponseCell = string | string[];
export type ResponseRow = Record<string, ResponseCell>;

export interface ResponseTable {
  columns: ResponseColumn[];
  rows: ResponseRow[];
}

/**
 * The part of a question group (a grid) the response table needs.
 *
 * The document models a grid as `type: unsupported` — it is one item holding
 * several questions, and 0027's flat projection has no shape for that. But a
 * response carries an answer for every *row*, keyed by the row's own question
 * id, so a table that ignored `raw` would drop a whole block of real answers
 * while reporting success. Reading is safe where writing is not: nothing here
 * sends the parsed shape back.
 */
const GridRawSchema = z.object({
  title: z.string().nullish(),
  questionGroupItem: z.object({
    grid: z.object({ columns: z.object({ type: z.string().nullish() }).nullish() }).nullish(),
    questions: z
      .array(
        z.object({
          questionId: z.string().nullish(),
          rowQuestion: z.object({ title: z.string().nullish() }).nullish(),
        }),
      )
      .nullish(),
  }),
});

function gridColumns(raw: unknown): ResponseColumn[] {
  const parsed = GridRawSchema.safeParse(raw);
  if (!parsed.success) return [];
  const { title, questionGroupItem } = parsed.data;
  // The same map the projection uses, so a grid and a plain question cannot
  // disagree about what `CHECKBOX` is (see `choiceTypeOf`).
  const multi = choiceTypeOf(questionGroupItem.grid?.columns?.type) === "checkbox";

  const columns: ResponseColumn[] = [];
  for (const question of questionGroupItem.questions ?? []) {
    const questionId = question.questionId;
    if (!questionId) continue;
    const rowTitle = question.rowQuestion?.title;
    const parts = [title, rowTitle].filter(
      (part) => part !== null && part !== undefined && part !== "",
    );
    columns.push({
      title: parts.length === 0 ? questionId : parts.join(" — "),
      question_id: questionId,
      multi,
    });
  }
  return columns;
}

/**
 * The question columns, in form order. An item the schema could not model
 * still gets one when it carries a `question_id`: its answers are as real as
 * any other, and dropping the column would silently lose them.
 */
function questionColumns(document: FormDocument): ResponseColumn[] {
  const columns: ResponseColumn[] = [];
  for (const item of document.items) {
    if (item.type === "unsupported") {
      // A grid holds its question ids one level down, inside `raw`.
      const grid = gridColumns(item.raw);
      if (grid.length > 0) {
        columns.push(...grid);
        continue;
      }
    }
    if (!("question_id" in item)) continue;
    const questionId = item.question_id;
    if (questionId === undefined) continue;
    columns.push({
      // An untitled question is named by the only thing that identifies it.
      title: item.title === undefined || item.title === "" ? questionId : item.title,
      question_id: questionId,
      multi:
        (item.type === "choice" && item.choice_type === "checkbox") || item.type === "file_upload",
    });
  }
  return columns;
}

/** How many times each title appears, with `submitted` already taken. */
function titleCounts(columns: ResponseColumn[]): Map<string, number> {
  const counts = new Map<string, number>([[SUBMITTED_COLUMN, 1]]);
  for (const column of columns) counts.set(column.title, (counts.get(column.title) ?? 0) + 1);
  return counts;
}

/**
 * Appends ` (<question_id>)` to every column whose title is not its own —
 * two questions worded the same way, or one worded like the `submitted`
 * column. Disambiguating both of a pair keeps the header symmetric, so a
 * caller cannot mistake one of them for the original.
 *
 * Repeated until the titles are distinct, because a row is a map keyed by
 * title: a question deliberately titled `Name (qb)` beside the `Name` pair
 * that disambiguates *to* `Name (qb)` would otherwise have one answer
 * overwrite the other. Question ids are unique, so a second pass always
 * separates what the first collided; the bound is a guard, not an expectation.
 */
function disambiguate(columns: ResponseColumn[]): ResponseColumn[] {
  let current = columns;
  for (let pass = 0; pass < 3; pass += 1) {
    const counts = titleCounts(current);
    if (current.every((column) => (counts.get(column.title) ?? 0) <= 1)) break;
    current = current.map((column) =>
      (counts.get(column.title) ?? 0) > 1
        ? { ...column, title: `${column.title} (${column.question_id ?? ""})` }
        : column,
    );
  }
  return current;
}

function answerValues(answer: AnswerRaw | undefined): string[] {
  if (answer === undefined) return [];
  const files = answer.fileUploadAnswers?.answers;
  // A file upload reports Drive ids, which `gdrive info` accepts (0027 §6).
  if (files !== undefined) return files.map((file) => file.fileId ?? "");
  return (answer.textAnswers?.answers ?? []).map((text) => text.value ?? "");
}

/**
 * Joins responses with the form (decision 0027 §6): the API keys answers by
 * question id and says nothing about what was asked, so the form's titles are
 * what makes the table readable.
 */
export function tabulateResponses(
  document: FormDocument,
  responses: FormResponseRaw[],
): ResponseTable {
  const columns: ResponseColumn[] = [
    { title: SUBMITTED_COLUMN, question_id: null, multi: false },
    ...disambiguate(questionColumns(document)),
  ];

  const rows = responses.map((response) => {
    const row: ResponseRow = {};
    for (const column of columns) {
      if (column.question_id === null) {
        row[column.title] = response.lastSubmittedTime ?? response.createTime ?? "";
        continue;
      }
      const values = answerValues(response.answers?.[column.question_id]);
      row[column.title] = column.multi ? values : values.join("; ");
    }
    return row;
  });

  return { columns, rows };
}

/** The table as a grid of strings — the shape `table` and `csv` render. */
export function responseGrid(table: ResponseTable): string[][] {
  const header = table.columns.map((column) => column.title);
  const rows = table.rows.map((row) =>
    table.columns.map((column) => {
      const cell = row[column.title] ?? "";
      return Array.isArray(cell) ? cell.join("; ") : cell;
    }),
  );
  return [header, ...rows];
}
