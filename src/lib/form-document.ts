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

// --- Raw Forms v1 shapes a request carries (decision 0028) ------------------

/**
 * The write half of the API resource. It is a separate set of types from the
 * read half above for two reasons: what a request may send is a strict subset —
 * an image is output-only, an `unsupported` item is never sent at all (0028 §2)
 * — and every field here has to be a *concrete* shape, because
 * `google-clients.ts` checks the request union against the generated
 * `forms_v1` types and `unknown` would defeat that check
 * ([0015](../../decisions/0015-no-type-assertions.md)).
 */
export interface OptionWrite {
  /**
   * Absent on the write-in option, and only there: the API answers "Cannot set
   * option.value or option.image when option.isOther is true".
   */
  value?: string;
  isOther?: boolean;
  goToAction?: string;
  goToSectionId?: string;
}

export interface QuestionWrite {
  questionId?: string;
  required: boolean;
  choiceQuestion?: { type: string; options: OptionWrite[]; shuffle?: boolean };
  scaleQuestion?: { low: number; high: number; lowLabel?: string; highLabel?: string };
  textQuestion?: { paragraph: boolean };
  dateQuestion?: { includeTime: boolean; includeYear: boolean };
  timeQuestion?: { duration: boolean };
  fileUploadQuestion?: {
    folderId?: string;
    maxFiles?: number;
    maxFileSize?: string;
    types?: string[];
  };
}

export interface ItemWrite {
  itemId?: string;
  title?: string;
  description?: string;
  questionItem?: { question: QuestionWrite };
  pageBreakItem?: Record<string, never>;
  textItem?: Record<string, never>;
}

// --- The document schema (decision 0027 §2) ---------------------------------

/**
 * A choice. A bare string is the common case; the object form carries the
 * fields that make an option more than its label — `other`, and the section
 * navigation an update would otherwise silently drop.
 *
 * `value` is optional because the write-in option may not carry one: the API
 * refuses `value` beside `isOther`, so the label of that one option is Google's
 * and `{other: true}` on its own is the whole option.
 */
const ChoiceOptionSchema = z.union([
  z.string(),
  z.object({
    value: z.string().optional(),
    other: z.boolean().optional(),
    go_to_action: z.string().optional(),
    go_to_section_id: z.string().optional(),
  }),
]);

/**
 * The schema is declared in the order the projection emits — identity, `type`
 * and its discriminator, prose, then payload — because zod hands the parsed
 * object's keys back in *declaration* order. Written any other way, a document
 * that went through `parseFormDocument` and back out through
 * `formDocumentToYaml` would come out reordered, and the two halves of this
 * file would disagree about the shape of the thing they both own.
 *
 * Ids are output-only: `read` always emits them, a new item simply has none.
 */
const itemIdentityShape = { id: z.string().optional() };
const questionIdentityShape = { ...itemIdentityShape, question_id: z.string().optional() };

const itemProseShape = {
  title: z.string().optional(),
  description: z.string().optional(),
};

const questionProseShape = { ...itemProseShape, required: z.boolean().optional() };

export const CHOICE_TYPES = ["radio", "checkbox", "dropdown"] as const;

const FormItemSchema = z.discriminatedUnion("type", [
  z.object({
    ...questionIdentityShape,
    type: z.literal("choice"),
    choice_type: z.enum(CHOICE_TYPES),
    ...questionProseShape,
    shuffle: z.boolean().optional(),
    options: z.array(ChoiceOptionSchema),
  }),
  z.object({
    ...questionIdentityShape,
    type: z.literal("scale"),
    ...questionProseShape,
    low: z.number(),
    high: z.number(),
    low_label: z.string().optional(),
    high_label: z.string().optional(),
  }),
  z.object({
    ...questionIdentityShape,
    type: z.literal("text"),
    ...questionProseShape,
    paragraph: z.boolean().optional(),
  }),
  z.object({
    ...questionIdentityShape,
    type: z.literal("date"),
    ...questionProseShape,
    include_time: z.boolean().optional(),
    include_year: z.boolean().optional(),
  }),
  z.object({
    ...questionIdentityShape,
    type: z.literal("time"),
    ...questionProseShape,
    duration: z.boolean().optional(),
  }),
  z.object({
    ...questionIdentityShape,
    type: z.literal("file_upload"),
    ...questionProseShape,
    folder_id: z.string().optional(),
    max_files: z.number().optional(),
    max_file_size: z.string().optional(),
    types: z.array(z.string()).optional(),
  }),
  z.object({ ...itemIdentityShape, type: z.literal("page_break"), ...itemProseShape }),
  z.object({ ...itemIdentityShape, type: z.literal("text_item"), ...itemProseShape }),
  z.object({
    ...questionIdentityShape,
    type: z.literal("unsupported"),
    ...itemProseShape,
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

/**
 * The document's name for an API `ChoiceQuestion.type`, or `undefined` for one
 * this CLI has no name for.
 *
 * Exported because a grid's columns are a `ChoiceQuestion` too, and the
 * response table reads them (`forms-api.ts`). Two maps meant the same form
 * could read one way as a question and another as a grid.
 *
 * `CHECKBOX` is the spelling: it is the public `ChoiceType` enum value, and the
 * one the `Option.isOther` and `TextAnswer.value` comments use. The
 * `Grid.columns` comment says `CHECK_BOX`, which is the proto spelling of the
 * same constant — accepting it here would be guessing at an enum Google
 * documents only one way.
 */
export function choiceTypeOf(apiType: string | null | undefined): ChoiceType | undefined {
  return CHOICE_TYPE_BY_API[apiType ?? ""];
}

/** Fields common to every item, so they never name the item's kind. */
const ITEM_META = new Set(["itemId", "title", "description"]);
/** Likewise for a question: what is left is the kind. */
const QUESTION_META = new Set(["questionId", "required", "grading"]);

/**
 * The keys are emitted in the order 0027 §2 shows them — what the item *is*
 * (`id`, `question_id`, `type`) before what it says — because the document is
 * meant to be read and diffed. Hence the split: {@link identity} opens an item
 * and {@link prose} follows its `type`. An absent or empty field is left out
 * entirely rather than written as `""`.
 */
function identity(item: ItemRaw, question?: QuestionRaw): { id?: string; question_id?: string } {
  const { itemId } = item;
  const questionId = question?.questionId;
  return {
    ...(itemId ? { id: itemId } : {}),
    ...(questionId ? { question_id: questionId } : {}),
  };
}

function prose(item: ItemRaw): { title?: string; description?: string } {
  const { title, description } = item;
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
  };
}

function questionProse(
  item: ItemRaw,
  question: QuestionRaw,
): { title?: string; description?: string; required: boolean } {
  return { ...prose(item), required: question.required === true };
}

function toOption(option: OptionRaw): z.infer<typeof ChoiceOptionSchema> {
  const { goToAction, goToSectionId } = option;
  const value = option.value ?? "";
  const extras = {
    ...(option.isOther === true ? { other: true } : {}),
    ...(goToAction ? { go_to_action: goToAction } : {}),
    ...(goToSectionId ? { go_to_section_id: goToSectionId } : {}),
  };
  if (Object.keys(extras).length === 0) return value;
  // A label Google did not give is not written as `value: ""`; the write-in
  // option is the one that may have none, and `{other: true}` says so.
  return { ...(value === "" ? {} : { value }), ...extras };
}

/** The first key that is not shared by every item/question — the kind's name. */
function kindKey(resource: object, meta: Set<string>): string | undefined {
  return Object.keys(resource).find((key) => !meta.has(key));
}

/** An item and, when the schema could not hold it, why (decision 0021 §3). */
interface Projected {
  item: FormItem;
  note?: UnsupportedItemNote;
}

/**
 * Emits the item through 0027 §4's channel: the API resource verbatim under
 * `raw`, and a note naming the field that could not be held. `kind` is passed
 * in rather than re-derived, so the reason travels with the decision that a
 * projection was impossible instead of being guessed afterwards.
 */
function unsupported(item: ItemRaw, kind: string, question?: QuestionRaw): Projected {
  return {
    item: {
      // `question_id` is kept even here, so `forms responses` can still name
      // the column and the answers are not lost with the question (0027 §3).
      ...identity(item, question),
      type: "unsupported",
      // The title and description are duplicated inside `raw` on purpose: they
      // are what tells one opaque node from another in a diff, and what heads
      // the response column. They are an echo, not an edit point — 0028 §2
      // emits neither an update nor a delete for an `unsupported` item, and the
      // one request it does allow, `moveItem`, carries no content. So `raw` is
      // the only copy that is ever the form; `docs/commands.md` says so.
      ...prose(item),
      // Verbatim, so an edit that did not touch this item cannot destroy it.
      raw: item,
    },
    note: { id: item.itemId ?? "", kind },
  };
}

/**
 * An image on a question or on one of its options.
 *
 * The document cannot express one: the API returns `contentUri`, which is
 * output-only and expires, while creating an image needs `sourceUri`, which is
 * input-only. Projecting it would be a field a write could not send back, and
 * dropping it would let `updateItem` delete the image on the first round trip
 * — the loss 0027 §4 exists to prevent. So the whole question goes through §4's
 * channel, where 0028 §2 guarantees no request is emitted for it and the image
 * survives untouched.
 *
 * The cost is that an image-bearing question loses its readable form; 0027's
 * consequences call that "the signal to extend the schema", which is a decision
 * for a record, not for this function.
 */
function imageField(item: ItemRaw, question: QuestionRaw): string | undefined {
  if (item.questionItem?.image !== undefined) return "questionItem.image";
  const options = question.choiceQuestion?.options ?? [];
  return options.some((option) => option.image !== undefined) ? "option.image" : undefined;
}

function toQuestionItem(item: ItemRaw, question: QuestionRaw): Projected {
  const head = identity(item, question);
  const tail = questionProse(item, question);

  const image = imageField(item, question);
  if (image !== undefined) return unsupported(item, image, question);

  const choice = question.choiceQuestion;
  if (choice !== undefined) {
    const choiceType = choiceTypeOf(choice.type);
    // A choice kind this CLI has no name for is not approximated as another.
    if (choiceType === undefined) return unsupported(item, "choiceQuestion.type", question);
    return {
      item: {
        ...head,
        type: "choice",
        choice_type: choiceType,
        ...tail,
        ...(choice.shuffle === true ? { shuffle: true } : {}),
        options: (choice.options ?? []).map(toOption),
      },
    };
  }

  const scale = question.scaleQuestion;
  if (scale !== undefined) {
    const { low, high, lowLabel, highLabel } = scale;
    // Both bounds are required by the API. A scale without them is not a scale
    // this CLI can describe, and 1..0 would be a plausible-looking lie.
    if (typeof low !== "number" || typeof high !== "number") {
      return unsupported(item, "scaleQuestion", question);
    }
    return {
      item: {
        ...head,
        type: "scale",
        ...tail,
        low,
        high,
        ...(lowLabel ? { low_label: lowLabel } : {}),
        ...(highLabel ? { high_label: highLabel } : {}),
      },
    };
  }

  const text = question.textQuestion;
  if (text !== undefined) {
    return { item: { ...head, type: "text", ...tail, paragraph: text.paragraph === true } };
  }

  const date = question.dateQuestion;
  if (date !== undefined) {
    return {
      item: {
        ...head,
        type: "date",
        ...tail,
        include_time: date.includeTime === true,
        include_year: date.includeYear === true,
      },
    };
  }

  const time = question.timeQuestion;
  if (time !== undefined) {
    return { item: { ...head, type: "time", ...tail, duration: time.duration === true } };
  }

  const file = question.fileUploadQuestion;
  if (file !== undefined) {
    const { folderId, maxFiles, maxFileSize, types } = file;
    return {
      item: {
        ...head,
        type: "file_upload",
        ...tail,
        ...(folderId ? { folder_id: folderId } : {}),
        ...(typeof maxFiles === "number" ? { max_files: maxFiles } : {}),
        ...(maxFileSize ? { max_file_size: maxFileSize } : {}),
        ...(types ? { types } : {}),
      },
    };
  }

  return unsupported(item, kindKey(question, QUESTION_META) ?? "questionItem", question);
}

function toItemProjection(item: ItemRaw): Projected {
  const question = item.questionItem?.question;
  if (question !== undefined) return toQuestionItem(item, question);
  if (item.pageBreakItem !== undefined) {
    return { item: { ...identity(item), type: "page_break", ...prose(item) } };
  }
  if (item.textItem !== undefined) {
    return { item: { ...identity(item), type: "text_item", ...prose(item) } };
  }
  return unsupported(item, kindKey(item, ITEM_META) ?? "unknown");
}

/** One item's projection, which the write side compares an edit against. */
export function toDocumentItem(item: ItemRaw): FormItem {
  return toItemProjection(item).item;
}

/**
 * Projects a form resource onto the document (0027 §2), reporting the items
 * whose kind the schema does not model (0027 §4).
 */
export function toFormDocument(form: FormRaw): FormProjection {
  const notes: UnsupportedItemNote[] = [];
  const items = (form.items ?? []).map((raw) => {
    const { item, note } = toItemProjection(raw);
    if (note !== undefined) notes.push(note);
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
    unsupported: notes,
  };
}

// --- Document → API resource (decision 0028) --------------------------------

const API_BY_CHOICE_TYPE: Record<ChoiceType, string> = {
  radio: "RADIO",
  checkbox: "CHECKBOX",
  dropdown: "DROP_DOWN",
};

/**
 * An option as a request may carry it.
 *
 * `value` and `isOther` are mutually exclusive on the way in — the API answers
 * "Cannot set option.value or option.image when option.isOther is true" — so
 * the label of the write-in option is dropped here rather than sent. It is the
 * same treatment `question_id` gets (0028 §6): the document carries it so a
 * reader can see what the option says, and the write leaves it behind because
 * it is Google's to decide. Sending the pair made every form with an "Other"
 * option impossible to create or update.
 */
function toApiOption(option: z.infer<typeof ChoiceOptionSchema>): OptionWrite {
  if (typeof option === "string") return { value: option };
  const { value, other, go_to_action, go_to_section_id } = option;
  const navigation = {
    ...(go_to_action !== undefined ? { goToAction: go_to_action } : {}),
    ...(go_to_section_id !== undefined ? { goToSectionId: go_to_section_id } : {}),
  };
  if (other === true) return { isOther: true, ...navigation };
  return { value: value ?? "", ...navigation };
}

/**
 * A question item without its kind — everything a `Question` shares. `null`
 * where the API has no way to accept the kind at all.
 */
type QuestionKind = Omit<QuestionWrite, "questionId" | "required"> | null;

const QUESTION_TYPES = ["choice", "scale", "text", "date", "time", "file_upload"] as const;

function isQuestionType(type: FormItem["type"]): type is (typeof QUESTION_TYPES)[number] {
  return QUESTION_TYPES.some((candidate) => candidate === type);
}

/**
 * The one API field a `type` names (0027 §2). The `switch` is exhaustive over
 * the same discriminant the projection built, so a kind added to the schema
 * fails to compile here until it can be written as well as read.
 */
function toApiQuestion(
  item: Extract<FormItem, { type: (typeof QUESTION_TYPES)[number] }>,
): QuestionKind {
  switch (item.type) {
    case "choice":
      return {
        choiceQuestion: {
          type: API_BY_CHOICE_TYPE[item.choice_type],
          ...(item.shuffle === true ? { shuffle: true } : {}),
          options: item.options.map(toApiOption),
        },
      };
    case "scale":
      return {
        scaleQuestion: {
          low: item.low,
          high: item.high,
          ...(item.low_label !== undefined ? { lowLabel: item.low_label } : {}),
          ...(item.high_label !== undefined ? { highLabel: item.high_label } : {}),
        },
      };
    case "text":
      return { textQuestion: { paragraph: item.paragraph === true } };
    case "date":
      return {
        dateQuestion: {
          includeTime: item.include_time === true,
          includeYear: item.include_year === true,
        },
      };
    case "time":
      return { timeQuestion: { duration: item.duration === true } };
    case "file_upload":
      // Unreachable: {@link toApiItem} answers `null` before it gets here, and
      // the reason is written down there.
      return null;
  }
}

/**
 * The API resource a document item describes, or `null` for one no request can
 * carry. Two kinds answer `null`, for the same practical reason — a
 * `batchUpdate` is atomic, so a request the API refuses takes every edit beside
 * it down, and on `create` it does so after the empty form already exists:
 *
 * - `unsupported`, whose `raw` is the API's own shape rather than a request's
 *   (0028 §2);
 * - `file_upload`, because "the API currently does not support creating file
 *   upload questions" — Google's words, in the generated type this repo ships.
 *   So a file upload question reads, holds its position, and is never written.
 *
 * The ids are carried through: they are read-only as *instructions* (0028 §6),
 * and the caller that creates an item is the one that has to leave them off.
 */
export function toApiItem(item: FormItem): ItemWrite | null {
  if (item.type === "unsupported") return null;

  const head = {
    ...(item.id !== undefined ? { itemId: item.id } : {}),
    ...(item.title !== undefined ? { title: item.title } : {}),
    ...(item.description !== undefined ? { description: item.description } : {}),
  };

  if (item.type === "page_break") return { ...head, pageBreakItem: {} };
  if (item.type === "text_item") return { ...head, textItem: {} };
  if (!isQuestionType(item.type)) return null;

  const kind = toApiQuestion(item);
  if (kind === null) return null;

  return {
    ...head,
    questionItem: {
      question: {
        ...(item.question_id !== undefined ? { questionId: item.question_id } : {}),
        required: item.required === true,
        ...kind,
      },
    },
  };
}

/** True for a document item no request can carry — see {@link toApiItem}. */
export function isWritableItem(item: FormItem): boolean {
  return toApiItem(item) !== null;
}

const API_KIND_PATH: Record<Exclude<FormItem["type"], "unsupported">, string> = {
  choice: "questionItem.question.choiceQuestion",
  scale: "questionItem.question.scaleQuestion",
  text: "questionItem.question.textQuestion",
  date: "questionItem.question.dateQuestion",
  time: "questionItem.question.timeQuestion",
  file_upload: "questionItem.question.fileUploadQuestion",
  page_break: "pageBreakItem",
  text_item: "textItem",
};

/** Where an existing item keeps its kind, read off the resource's own keys. */
function apiKindPath(item: ItemRaw): string | undefined {
  const question = item.questionItem?.question;
  if (question !== undefined) {
    const key = kindKey(question, QUESTION_META);
    return key === undefined ? "questionItem" : `questionItem.question.${key}`;
  }
  return kindKey(item, ITEM_META);
}

/**
 * The `updateMask` for an `updateItem`, naming every field the document carries
 * and nothing else.
 *
 * A field mask clears what it names and the message leaves out, so the mask is
 * the whole safety story for an update: `questionItem.question` would name
 * `grading` — which 0027 defers, so no document has it — and Google's own field
 * documentation says clearing it "deletes all question Grading". The kind's own
 * path is as deep as this goes for the same reason.
 *
 * The one field named that the new item may not have is the kind the item is
 * *leaving*: a `text` question rewritten as a `choice` has to lose its
 * `textQuestion`, or the API is handed an item claiming two kinds at once.
 */
export function itemUpdateMask(item: FormItem, current: ItemRaw): string {
  if (item.type === "unsupported") return "";
  const kind = API_KIND_PATH[item.type];
  const question = isQuestionType(item.type);

  const paths = ["title", "description"];
  if (question) paths.push("questionItem.question.required");
  paths.push(kind);

  const leaving = apiKindPath(current);
  if (leaving !== undefined && leaving !== kind) {
    // An item that stops being a question takes the whole `questionItem` with
    // it — including the grading that belonged to the question that is gone.
    paths.push(!question && leaving.startsWith("questionItem") ? "questionItem" : leaving);
  }
  return paths.join(",");
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
