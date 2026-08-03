import YAML from "yaml";
import { z } from "zod";
import { AppError } from "../types/index.ts";

/**
 * The form document (decision 0027): one flat YAML projection of a form,
 * emitted by `forms read` and accepted back by `forms write` (0028). Both
 * directions live in this file so the taxonomy is written down once.
 */

// --- Raw Forms v1 shapes (only the fields we read) --------------------------

export interface OptionRaw {
  value?: string | null;
  isOther?: boolean | null;
  goToAction?: string | null;
  goToSectionId?: string | null;
  image?: unknown;
}

export interface ChoiceQuestionRaw {
  type?: string | null;
  options?: OptionRaw[] | null;
  shuffle?: boolean | null;
}

export interface ScaleQuestionRaw {
  low?: number | null;
  high?: number | null;
  lowLabel?: string | null;
  highLabel?: string | null;
}

export interface TextQuestionRaw {
  paragraph?: boolean | null;
}

export interface DateQuestionRaw {
  includeTime?: boolean | null;
  includeYear?: boolean | null;
}

export interface TimeQuestionRaw {
  duration?: boolean | null;
}

export interface FileUploadQuestionRaw {
  folderId?: string | null;
  maxFiles?: number | null;
  maxFileSize?: string | null;
  types?: string[] | null;
}

/**
 * A question. The kinds the document does not model are declared as `unknown`
 * so the API's shape stays visible here; they project to `type: unsupported`
 * (0027 §4), and a kind googleapis has not declared yet does too — the check is
 * made on the object's own keys, not on this list.
 */
export interface QuestionRaw {
  questionId?: string | null;
  required?: boolean | null;
  choiceQuestion?: ChoiceQuestionRaw;
  scaleQuestion?: ScaleQuestionRaw;
  textQuestion?: TextQuestionRaw;
  dateQuestion?: DateQuestionRaw;
  timeQuestion?: TimeQuestionRaw;
  fileUploadQuestion?: FileUploadQuestionRaw;
  ratingQuestion?: unknown;
  rowQuestion?: unknown;
  grading?: unknown;
}

export interface QuestionItemRaw {
  question?: QuestionRaw;
  image?: unknown;
}

export interface ItemRaw {
  itemId?: string | null;
  title?: string | null;
  description?: string | null;
  questionItem?: QuestionItemRaw;
  pageBreakItem?: object;
  textItem?: object;
  questionGroupItem?: unknown;
  imageItem?: unknown;
  videoItem?: unknown;
}

export interface FormInfoRaw {
  title?: string | null;
  description?: string | null;
  documentTitle?: string | null;
}

export interface FormRaw {
  formId?: string | null;
  info?: FormInfoRaw;
  items?: ItemRaw[] | null;
  linkedSheetId?: string | null;
  responderUri?: string | null;
  revisionId?: string | null;
  settings?: unknown;
  publishSettings?: unknown;
}

// --- The document schema (decision 0027 §2) ---------------------------------

/**
 * A choice. A bare string is the common case; the object form carries the
 * fields that make an option more than its label — `other`, and the section
 * navigation an update would otherwise silently drop.
 */
const ChoiceOptionSchema = z.union([
  z.string(),
  z.object({
    value: z.string(),
    other: z.boolean().optional(),
    go_to_action: z.string().optional(),
    go_to_section_id: z.string().optional(),
  }),
]);

/** Ids are output-only: `read` always emits them, a new item simply has none. */
const itemBase = {
  id: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
};

const questionBase = {
  ...itemBase,
  question_id: z.string().optional(),
  required: z.boolean().optional(),
};

export const CHOICE_TYPES = ["radio", "checkbox", "dropdown"] as const;

const FormItemSchema = z.discriminatedUnion("type", [
  z.object({
    ...questionBase,
    type: z.literal("choice"),
    choice_type: z.enum(CHOICE_TYPES),
    options: z.array(ChoiceOptionSchema),
    shuffle: z.boolean().optional(),
  }),
  z.object({
    ...questionBase,
    type: z.literal("scale"),
    low: z.number(),
    high: z.number(),
    low_label: z.string().optional(),
    high_label: z.string().optional(),
  }),
  z.object({
    ...questionBase,
    type: z.literal("text"),
    paragraph: z.boolean().optional(),
  }),
  z.object({
    ...questionBase,
    type: z.literal("date"),
    include_time: z.boolean().optional(),
    include_year: z.boolean().optional(),
  }),
  z.object({
    ...questionBase,
    type: z.literal("time"),
    duration: z.boolean().optional(),
  }),
  z.object({
    ...questionBase,
    type: z.literal("file_upload"),
    folder_id: z.string().optional(),
    max_files: z.number().optional(),
    max_file_size: z.string().optional(),
    types: z.array(z.string()).optional(),
  }),
  z.object({ ...itemBase, type: z.literal("page_break") }),
  z.object({ ...itemBase, type: z.literal("text_item") }),
  z.object({
    ...itemBase,
    question_id: z.string().optional(),
    type: z.literal("unsupported"),
    raw: z.unknown(),
  }),
]);

export const FormDocumentSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  revision_id: z.string().optional(),
  responder_uri: z.string().optional(),
  linked_sheet_id: z.string().optional(),
  items: z.array(FormItemSchema),
});

export type FormDocument = z.infer<typeof FormDocumentSchema>;
export type FormItem = z.infer<typeof FormItemSchema>;
export type ChoiceType = (typeof CHOICE_TYPES)[number];

/** An item whose kind the schema does not model, reported per 0021 §3. */
export interface UnsupportedItemNote {
  id: string;
  /** The API field that named the kind, e.g. `videoItem` or `ratingQuestion`. */
  kind: string;
}

export interface FormProjection {
  document: FormDocument;
  unsupported: UnsupportedItemNote[];
}

// --- API resource → document ------------------------------------------------

const CHOICE_TYPE_BY_API: Record<string, ChoiceType> = {
  RADIO: "radio",
  CHECKBOX: "checkbox",
  DROP_DOWN: "dropdown",
};

/** Fields common to every item, so they never name the item's kind. */
const ITEM_META = new Set(["itemId", "title", "description"]);
/** Likewise for a question: what is left is the kind. */
const QUESTION_META = new Set(["questionId", "required", "grading"]);

/**
 * The keys every item carries. An absent or empty field is left out entirely
 * rather than written as `""` — the document is meant to be read and edited.
 */
function base(item: ItemRaw): { id?: string; title?: string; description?: string } {
  const { itemId, title, description } = item;
  return {
    ...(itemId ? { id: itemId } : {}),
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
  };
}

function questionFields(
  item: ItemRaw,
  question: QuestionRaw,
): { id?: string; title?: string; description?: string; question_id?: string; required: boolean } {
  const { questionId } = question;
  return {
    ...base(item),
    ...(questionId ? { question_id: questionId } : {}),
    required: question.required === true,
  };
}

function toOption(option: OptionRaw): z.infer<typeof ChoiceOptionSchema> {
  const { goToAction, goToSectionId } = option;
  const value = option.value ?? "";
  const extras = {
    ...(option.isOther === true ? { other: true } : {}),
    ...(goToAction ? { go_to_action: goToAction } : {}),
    ...(goToSectionId ? { go_to_section_id: goToSectionId } : {}),
  };
  return Object.keys(extras).length === 0 ? value : { value, ...extras };
}

/** The first key that is not shared by every item/question — the kind's name. */
function kindKey(resource: object, meta: Set<string>): string | undefined {
  return Object.keys(resource).find((key) => !meta.has(key));
}

function unsupportedItem(item: ItemRaw, question?: QuestionRaw): FormItem {
  const questionId = question?.questionId;
  return {
    ...base(item),
    // Kept even here, so `forms responses` can still name the column (0027 §3).
    ...(questionId ? { question_id: questionId } : {}),
    type: "unsupported",
    // Verbatim, so an edit that did not touch this item cannot destroy it (0027 §4).
    raw: item,
  };
}

function toQuestionItem(item: ItemRaw, question: QuestionRaw): FormItem {
  const common = questionFields(item, question);

  const choice = question.choiceQuestion;
  if (choice !== undefined) {
    const choiceType = CHOICE_TYPE_BY_API[choice.type ?? ""];
    // A choice kind this CLI has no name for is not approximated as another.
    if (choiceType === undefined) return unsupportedItem(item, question);
    return {
      ...common,
      type: "choice",
      choice_type: choiceType,
      ...(choice.shuffle === true ? { shuffle: true } : {}),
      options: (choice.options ?? []).map(toOption),
    };
  }

  const scale = question.scaleQuestion;
  if (scale !== undefined) {
    const { lowLabel, highLabel } = scale;
    return {
      ...common,
      type: "scale",
      low: scale.low ?? 0,
      high: scale.high ?? 0,
      ...(lowLabel ? { low_label: lowLabel } : {}),
      ...(highLabel ? { high_label: highLabel } : {}),
    };
  }

  const text = question.textQuestion;
  if (text !== undefined) {
    return { ...common, type: "text", paragraph: text.paragraph === true };
  }

  const date = question.dateQuestion;
  if (date !== undefined) {
    return {
      ...common,
      type: "date",
      include_time: date.includeTime === true,
      include_year: date.includeYear === true,
    };
  }

  const time = question.timeQuestion;
  if (time !== undefined) {
    return { ...common, type: "time", duration: time.duration === true };
  }

  const file = question.fileUploadQuestion;
  if (file !== undefined) {
    const { folderId, maxFiles, maxFileSize, types } = file;
    return {
      ...common,
      type: "file_upload",
      ...(folderId ? { folder_id: folderId } : {}),
      ...(typeof maxFiles === "number" ? { max_files: maxFiles } : {}),
      ...(maxFileSize ? { max_file_size: maxFileSize } : {}),
      ...(types ? { types } : {}),
    };
  }

  return unsupportedItem(item, question);
}

function toItem(item: ItemRaw): FormItem {
  const question = item.questionItem?.question;
  if (question !== undefined) return toQuestionItem(item, question);
  if (item.pageBreakItem !== undefined) return { ...base(item), type: "page_break" };
  if (item.textItem !== undefined) return { ...base(item), type: "text_item" };
  return unsupportedItem(item);
}

/** Names the API kind an unsupported item came from, for the 0021 §3 report. */
function noteFor(item: ItemRaw): UnsupportedItemNote {
  const question = item.questionItem?.question;
  const kind =
    question === undefined
      ? kindKey(item, ITEM_META)
      : (kindKey(question, QUESTION_META) ?? "questionItem");
  return { id: item.itemId ?? "", kind: kind ?? "unknown" };
}

/**
 * Projects a form resource onto the document (0027 §2), reporting the items
 * whose kind the schema does not model (0027 §4).
 */
export function toFormDocument(form: FormRaw): FormProjection {
  const unsupported: UnsupportedItemNote[] = [];
  const items = (form.items ?? []).map((raw) => {
    const item = toItem(raw);
    if (item.type === "unsupported") unsupported.push(noteFor(raw));
    return item;
  });

  const { formId, revisionId, responderUri, linkedSheetId } = form;
  const description = form.info?.description;
  return {
    document: {
      ...(formId ? { id: formId } : {}),
      title: form.info?.title ?? "",
      ...(description ? { description } : {}),
      ...(revisionId ? { revision_id: revisionId } : {}),
      ...(responderUri ? { responder_uri: responderUri } : {}),
      ...(linkedSheetId ? { linked_sheet_id: linkedSheetId } : {}),
      items,
    },
    unsupported,
  };
}

// --- Document ⇄ YAML --------------------------------------------------------

/**
 * Serializes the document. `lineWidth: 0` disables folding: a wrapped title is
 * still valid YAML, but the document is meant to be read and diffed, and a
 * question re-wrapped by its length is neither.
 */
export function formDocumentToYaml(document: FormDocument): string {
  return YAML.stringify(document, { lineWidth: 0 });
}

/**
 * Parses a document, the entry point the write side (0028) builds its plan
 * from. Anything the schema does not accept is `INVALID_ARGS`: the document is
 * an argument, and the caller's next action is to fix it.
 */
export function parseFormDocument(text: string): FormDocument {
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError("INVALID_ARGS", `Invalid YAML: ${message}`);
  }

  const result = FormDocumentSchema.safeParse(parsed);
  if (!result.success) {
    const [issue] = result.error.issues;
    const where =
      issue === undefined || issue.path.length === 0 ? "" : ` at ${issue.path.join(".")}`;
    const why = issue === undefined ? "unexpected shape" : issue.message;
    throw new AppError("INVALID_ARGS", `Invalid form document${where}: ${why}`);
  }
  return result.data;
}
