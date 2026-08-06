import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { AppError } from "../types/index.ts";
import {
  formDocumentToYaml,
  itemUpdateMask,
  parseFormDocument,
  toApiItem,
  toDocumentItem,
  toFormDocument,
  type FormItem,
  type FormRaw,
  type ItemRaw,
} from "./form-document.ts";

/** The {@link AppError} code a call raises, without asserting on the error. */
function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;
  }
  return "no error";
}

/** One raw item of every modelled kind, in the order 0027 §2 lists them. */
const form: FormRaw = {
  formId: "1FoRm",
  info: {
    title: "2026 Engagement survey",
    description: "Takes about five minutes.\nAnswers are anonymous.",
  },
  revisionId: "00000007",
  responderUri: "https://docs.google.com/forms/d/e/1FaIpQ/viewform",
  linkedSheetId: "1ShEeT",
  items: [
    {
      itemId: "i-radio",
      title: "Which team are you on?",
      description: "Pick one.",
      questionItem: {
        question: {
          questionId: "q-radio",
          required: true,
          choiceQuestion: {
            type: "RADIO",
            options: [
              { value: "Sales" },
              { value: "Engineering" },
              { value: "Other", isOther: true },
            ],
          },
        },
      },
    },
    {
      itemId: "i-check",
      title: "Which tools do you use?",
      questionItem: {
        question: {
          questionId: "q-check",
          choiceQuestion: {
            type: "CHECKBOX",
            shuffle: true,
            // `goToAction` and `goToSectionId` are alternatives, so each
            // option carries at most one of them, as a real form does.
            options: [
              { value: "Docs" },
              { value: "Sheets", goToAction: "NEXT_SECTION" },
              { value: "Slides", goToSectionId: "i-page" },
            ],
          },
        },
      },
    },
    {
      itemId: "i-drop",
      title: "Office",
      questionItem: {
        question: {
          questionId: "q-drop",
          choiceQuestion: { type: "DROP_DOWN", options: [{ value: "Tokyo" }] },
        },
      },
    },
    {
      itemId: "i-scale",
      title: "How satisfied are you?",
      questionItem: {
        question: {
          questionId: "q-scale",
          required: true,
          scaleQuestion: { low: 1, high: 5, lowLabel: "Not at all", highLabel: "Very" },
        },
      },
    },
    {
      itemId: "i-text",
      title: "Anything else?",
      questionItem: { question: { questionId: "q-text", textQuestion: { paragraph: true } } },
    },
    {
      itemId: "i-date",
      title: "Start date",
      questionItem: {
        question: { questionId: "q-date", dateQuestion: { includeTime: true, includeYear: false } },
      },
    },
    {
      itemId: "i-time",
      title: "Preferred time",
      questionItem: { question: { questionId: "q-time", timeQuestion: { duration: false } } },
    },
    {
      itemId: "i-file",
      title: "Attach your slides",
      questionItem: {
        question: {
          questionId: "q-file",
          fileUploadQuestion: {
            folderId: "1FoLdEr",
            maxFiles: 3,
            maxFileSize: "10485760",
            types: ["PDF", "IMAGE"],
          },
        },
      },
    },
    { itemId: "i-page", title: "Section 2", description: "About the office", pageBreakItem: {} },
    { itemId: "i-note", title: "Thanks!", description: "Almost done.", textItem: {} },
  ],
};

describe("toFormDocument", () => {
  it("projects the form's own fields", () => {
    const { document } = toFormDocument(form);
    expect(document.id).toBe("1FoRm");
    expect(document.title).toBe("2026 Engagement survey");
    expect(document.description).toBe("Takes about five minutes.\nAnswers are anonymous.");
    expect(document.revision_id).toBe("00000007");
    expect(document.responder_uri).toBe("https://docs.google.com/forms/d/e/1FaIpQ/viewform");
    expect(document.linked_sheet_id).toBe("1ShEeT");
  });

  it("carries an id on every item and a question_id on every question", () => {
    const { document } = toFormDocument(form);
    expect(document.items.map((item) => item.id)).toEqual([
      "i-radio",
      "i-check",
      "i-drop",
      "i-scale",
      "i-text",
      "i-date",
      "i-time",
      "i-file",
      "i-page",
      "i-note",
    ]);
    const questionIds = document.items.map((item) =>
      "question_id" in item ? item.question_id : undefined,
    );
    expect(questionIds.slice(0, 8)).toEqual([
      "q-radio",
      "q-check",
      "q-drop",
      "q-scale",
      "q-text",
      "q-date",
      "q-time",
      "q-file",
    ]);
  });

  it("flattens a radio question, keeping an `other` option", () => {
    const { document } = toFormDocument(form);
    expect(document.items[0]).toEqual({
      id: "i-radio",
      question_id: "q-radio",
      type: "choice",
      choice_type: "radio",
      title: "Which team are you on?",
      description: "Pick one.",
      required: true,
      options: ["Sales", "Engineering", { value: "Other", other: true }],
    });
  });

  it("flattens a checkbox question with its shuffle and navigation", () => {
    const { document } = toFormDocument(form);
    expect(document.items[1]).toEqual({
      id: "i-check",
      question_id: "q-check",
      type: "choice",
      choice_type: "checkbox",
      title: "Which tools do you use?",
      required: false,
      shuffle: true,
      options: [
        "Docs",
        { value: "Sheets", go_to_action: "NEXT_SECTION" },
        { value: "Slides", go_to_section_id: "i-page" },
      ],
    });
  });

  it("flattens a dropdown question", () => {
    const { document } = toFormDocument(form);
    expect(document.items[2]).toMatchObject({ type: "choice", choice_type: "dropdown" });
  });

  it("flattens a scale question with its labels", () => {
    const { document } = toFormDocument(form);
    expect(document.items[3]).toEqual({
      id: "i-scale",
      question_id: "q-scale",
      type: "scale",
      title: "How satisfied are you?",
      required: true,
      low: 1,
      high: 5,
      low_label: "Not at all",
      high_label: "Very",
    });
  });

  it("flattens a text question with its paragraph flag", () => {
    const { document } = toFormDocument(form);
    expect(document.items[4]).toEqual({
      id: "i-text",
      question_id: "q-text",
      type: "text",
      title: "Anything else?",
      required: false,
      paragraph: true,
    });
  });

  it("flattens date and time questions", () => {
    const { document } = toFormDocument(form);
    expect(document.items[5]).toEqual({
      id: "i-date",
      question_id: "q-date",
      type: "date",
      title: "Start date",
      required: false,
      include_time: true,
      include_year: false,
    });
    expect(document.items[6]).toEqual({
      id: "i-time",
      question_id: "q-time",
      type: "time",
      title: "Preferred time",
      required: false,
      duration: false,
    });
  });

  it("flattens a file upload question", () => {
    const { document } = toFormDocument(form);
    expect(document.items[7]).toEqual({
      id: "i-file",
      question_id: "q-file",
      type: "file_upload",
      title: "Attach your slides",
      required: false,
      folder_id: "1FoLdEr",
      max_files: 3,
      max_file_size: "10485760",
      types: ["PDF", "IMAGE"],
    });
  });

  it("projects a page break and a text block", () => {
    const { document } = toFormDocument(form);
    expect(document.items[8]).toEqual({
      id: "i-page",
      type: "page_break",
      title: "Section 2",
      description: "About the office",
    });
    expect(document.items[9]).toEqual({
      id: "i-note",
      type: "text_item",
      title: "Thanks!",
      description: "Almost done.",
    });
  });

  it("reports nothing unsupported for a fully modelled form", () => {
    expect(toFormDocument(form).unsupported).toEqual([]);
  });
});

describe("toFormDocument with an item the schema does not model", () => {
  const videoItem = { youtubeUri: "https://youtu.be/abc" };
  const withVideo: FormRaw = {
    info: { title: "Onboarding" },
    items: [
      { itemId: "i-video", title: "Watch this", videoItem: { video: videoItem } },
      { itemId: "i-image", imageItem: { image: { altText: "logo" } } },
      {
        itemId: "i-rating",
        title: "Rate us",
        questionItem: {
          question: { questionId: "q-rating", ratingQuestion: { ratingScaleLevel: 5 } },
        },
      },
    ],
  };

  it("keeps the API resource verbatim under `raw`", () => {
    const { document } = toFormDocument(withVideo);
    expect(document.items[0]).toEqual({
      id: "i-video",
      type: "unsupported",
      title: "Watch this",
      raw: { itemId: "i-video", title: "Watch this", videoItem: { video: videoItem } },
    });
  });

  it("still carries question_id for an unmodelled question, so responses can join", () => {
    const { document } = toFormDocument(withVideo);
    expect(document.items[2]).toMatchObject({
      id: "i-rating",
      type: "unsupported",
      title: "Rate us",
      question_id: "q-rating",
    });
  });

  it("counts each one as an unsupported note, naming the API kind", () => {
    expect(toFormDocument(withVideo).unsupported).toEqual([
      { id: "i-video", kind: "videoItem" },
      { id: "i-image", kind: "imageItem" },
      { id: "i-rating", kind: "ratingQuestion" },
    ]);
  });
});

/**
 * A field *below* the item level that the schema cannot hold is the same
 * failure 0027 §4 exists to prevent: projecting the question and dropping the
 * field would report the document as fully modelled while a write destroyed
 * the part that was dropped. Neither an image's `contentUri` (output only, and
 * short-lived) nor `sourceUri` (input only) can round-trip through a document,
 * so the item goes through §4's channel instead.
 */
describe("toFormDocument with a field it cannot model inside a question", () => {
  const withQuestionImage: FormRaw = {
    info: { title: "Geography" },
    items: [
      {
        itemId: "i-img",
        title: "Capital of France?",
        questionItem: {
          image: { contentUri: "https://lh3.example/map", altText: "map" },
          question: {
            questionId: "q-img",
            choiceQuestion: { type: "RADIO", options: [{ value: "Paris" }, { value: "Rome" }] },
          },
        },
      },
    ],
  };

  const withOptionImage: FormRaw = {
    info: { title: "Geography" },
    items: [
      {
        itemId: "i-opt",
        title: "Which flag?",
        questionItem: {
          question: {
            questionId: "q-opt",
            choiceQuestion: {
              type: "RADIO",
              options: [{ value: "France", image: { contentUri: "https://lh3.example/fr" } }],
            },
          },
        },
      },
    ],
  };

  it("does not report a question carrying an image as fully modelled", () => {
    const { document, unsupported } = toFormDocument(withQuestionImage);
    expect(unsupported).toEqual([{ id: "i-img", kind: "questionItem.image" }]);
    expect(document.items[0]).toMatchObject({
      id: "i-img",
      question_id: "q-img",
      type: "unsupported",
      title: "Capital of France?",
    });
  });

  it("keeps that question's whole resource, image included, under `raw`", () => {
    const [item] = toFormDocument(withQuestionImage).document.items;
    expect(item?.type).toBe("unsupported");
    expect(item?.type === "unsupported" ? item.raw : undefined).toEqual(
      withQuestionImage.items?.[0],
    );
  });

  it("does the same for an image attached to one option", () => {
    const { document, unsupported } = toFormDocument(withOptionImage);
    expect(unsupported).toEqual([{ id: "i-opt", kind: "option.image" }]);
    expect(document.items[0]).toMatchObject({ type: "unsupported", question_id: "q-opt" });
  });

  /**
   * Whether Google returns a label beside `isOther` is Google's business; the
   * document has to read well either way, and both spellings have to survive a
   * write.
   */
  it("reads an Other option Google labelled, and one it did not, without inventing a label", () => {
    const withOther: FormRaw = {
      info: { title: "Survey" },
      items: [
        {
          itemId: "i-other",
          questionItem: {
            question: {
              questionId: "q-other",
              choiceQuestion: {
                type: "RADIO",
                options: [{ value: "Sales" }, { value: "Other", isOther: true }, { isOther: true }],
              },
            },
          },
        },
      ],
    };
    const [item] = toFormDocument(withOther).document.items;
    expect(item?.type === "choice" ? item.options : []).toEqual([
      "Sales",
      { value: "Other", other: true },
      { other: true },
    ]);
  });

  it("names an unknown choice type rather than approximating it", () => {
    const unknownChoice: FormRaw = {
      info: { title: "Survey" },
      items: [
        {
          itemId: "i-new",
          questionItem: {
            question: { questionId: "q-new", choiceQuestion: { type: "SOMETHING_NEW" } },
          },
        },
      ],
    };
    expect(toFormDocument(unknownChoice).unsupported).toEqual([
      { id: "i-new", kind: "choiceQuestion.type" },
    ]);
  });

  it("does not invent a bound for a scale the API did not bound", () => {
    const boundless: FormRaw = {
      info: { title: "Survey" },
      items: [
        {
          itemId: "i-scale",
          title: "How satisfied?",
          questionItem: { question: { questionId: "q-scale", scaleQuestion: { low: 1 } } },
        },
      ],
    };
    const { document, unsupported } = toFormDocument(boundless);
    expect(unsupported).toEqual([{ id: "i-scale", kind: "scaleQuestion" }]);
    expect(document.items[0]).toMatchObject({ type: "unsupported" });
  });
});

/**
 * The key order is a contract, not an accident: 0027 §2 writes a document in
 * this order and the document is meant to be read and diffed. Both halves of
 * this file owe it — what `read` emits, and what `parseFormDocument` hands the
 * write side back.
 */
describe("the order of an item's keys", () => {
  it("names the item before it describes it, as 0027 §2 writes it", () => {
    const { document } = toFormDocument(form);
    expect(Object.keys(document.items[0] ?? {})).toEqual([
      "id",
      "question_id",
      "type",
      "choice_type",
      "title",
      "description",
      "required",
      "options",
    ]);
    expect(Object.keys(document.items[3] ?? {})).toEqual([
      "id",
      "question_id",
      "type",
      "title",
      "required",
      "low",
      "high",
      "low_label",
      "high_label",
    ]);
    expect(Object.keys(document.items[8] ?? {})).toEqual(["id", "type", "title", "description"]);
  });

  it("gives the form's own keys the same treatment", () => {
    const { document } = toFormDocument(form);
    expect(Object.keys(document)).toEqual([
      "id",
      "title",
      "description",
      "revision_id",
      "responder_uri",
      "linked_sheet_id",
      "items",
    ]);
  });

  /**
   * The test above cannot tell "declaration order" from "input order": what it
   * parses is already in emission order. This one arrives shuffled, so only the
   * schema's own declaration order can produce the result.
   */
  it("returns declaration order however the document arrived", () => {
    const shuffled = [
      "items:",
      "  - options: [Sales, Engineering]",
      "    required: true",
      "    title: Which team are you on?",
      "    choice_type: radio",
      "    type: choice",
      "    question_id: q1",
      "    id: i1",
      "title: Survey",
    ].join("\n");
    const parsed = parseFormDocument(shuffled);
    expect(Object.keys(parsed)).toEqual(["title", "items"]);
    expect(Object.keys(parsed.items[0] ?? {})).toEqual([
      "id",
      "question_id",
      "type",
      "choice_type",
      "title",
      "required",
      "options",
    ]);
  });

  it("hands the same order back out of parseFormDocument", () => {
    const { document } = toFormDocument(form);
    const parsed = parseFormDocument(formDocumentToYaml(document));
    expect(Object.keys(parsed)).toEqual(Object.keys(document));
    for (const [index, item] of parsed.items.entries()) {
      expect(Object.keys(item)).toEqual(Object.keys(document.items[index] ?? {}));
    }
  });
});

describe("formDocumentToYaml", () => {
  it("round-trips through a YAML parser unchanged", () => {
    const { document } = toFormDocument(form);
    expect(YAML.parse(formDocumentToYaml(document))).toEqual(document);
  });

  it("writes multi-line prose as a block scalar rather than escapes", () => {
    const { document } = toFormDocument(form);
    expect(formDocumentToYaml(document)).toContain("description: |-\n  Takes about five minutes.");
  });

  it("never folds a long line, however long the question", () => {
    const long = `Which of the following best describes ${"the way your team works together"} on a day-to-day basis, in an average week?`;
    const { document } = toFormDocument({
      info: { title: "Survey" },
      items: [
        {
          itemId: "i1",
          title: long,
          questionItem: { question: { questionId: "q1", textQuestion: {} } },
        },
      ],
    });
    expect(formDocumentToYaml(document)).toBe(
      [
        "title: Survey",
        "items:",
        "  - id: i1",
        "    question_id: q1",
        "    type: text",
        `    title: ${long}`,
        "    required: false",
        "    paragraph: false",
        "",
      ].join("\n"),
    );
  });
});

/**
 * The other direction (decision 0028). What makes one document serve both is
 * that `type` names exactly one API shape (0027 §2), so these tests are about
 * that correspondence holding in both directions at once.
 */
/**
 * The item as it survives a write. An "Other" option's label is Google's — the
 * API refuses `value` beside `isOther` — so the document carries it for a
 * reader and a write leaves it behind, the way it leaves a `question_id`
 * behind. Nothing else in the document is dropped on the way out.
 */
function asWritten(item: FormItem): FormItem {
  if (item.type !== "choice") return item;
  return {
    ...item,
    options: item.options.map((option) => {
      if (typeof option === "string" || option.other !== true) return option;
      const { value: _label, ...rest } = option;
      return rest;
    }),
  };
}

describe("toApiItem", () => {
  const items = toFormDocument(form).document.items;
  const at = (index: number): FormItem => {
    const item = items[index];
    if (item === undefined) throw new Error(`no fixture item at ${index}`);
    return item;
  };

  it("rebuilds a choice question, spelling the API's own enum", () => {
    expect(toApiItem(at(0))).toEqual({
      itemId: "i-radio",
      title: "Which team are you on?",
      description: "Pick one.",
      questionItem: {
        question: {
          questionId: "q-radio",
          required: true,
          choiceQuestion: {
            type: "RADIO",
            options: [{ value: "Sales" }, { value: "Engineering" }, { isOther: true }],
          },
        },
      },
    });
  });

  /**
   * `isOther` and `value` are mutually exclusive on the way in — the API
   * answers "Cannot set option.value or option.image when option.isOther is
   * true" — so the label of the write-in choice belongs to Google, not to the
   * document. Sending the pair made every real form with an "Other" option
   * impossible to create or update, and no round-trip test caught it: an
   * unedited document builds no request at all, so nothing was ever sent.
   */
  it("sends an Other option as isOther alone, never beside a label", () => {
    const [item] = parseFormDocument(
      [
        "title: T",
        "items:",
        "  - type: choice",
        "    choice_type: radio",
        "    title: Which team?",
        "    options:",
        "      - Sales",
        "      - value: Other",
        "        other: true",
      ].join("\n"),
    ).items;
    if (item === undefined) throw new Error("fixture");
    expect(toApiItem(item)?.questionItem?.question.choiceQuestion?.options).toEqual([
      { value: "Sales" },
      { isOther: true },
    ]);
  });

  it("keeps an Other option's section navigation, which is not a label", () => {
    const [item] = parseFormDocument(
      [
        "title: T",
        "items:",
        "  - type: choice",
        "    choice_type: radio",
        "    options:",
        "      - other: true",
        "        go_to_action: SUBMIT_FORM",
      ].join("\n"),
    ).items;
    if (item === undefined) throw new Error("fixture");
    expect(toApiItem(item)?.questionItem?.question.choiceQuestion?.options).toEqual([
      { isOther: true, goToAction: "SUBMIT_FORM" },
    ]);
  });

  it("carries an option's shuffle and section navigation back", () => {
    expect(toApiItem(at(1))).toMatchObject({
      questionItem: {
        question: {
          choiceQuestion: {
            type: "CHECKBOX",
            shuffle: true,
            options: [
              { value: "Docs" },
              { value: "Sheets", goToAction: "NEXT_SECTION" },
              { value: "Slides", goToSectionId: "i-page" },
            ],
          },
        },
      },
    });
  });

  it("rebuilds every other modelled kind under its own API field", () => {
    const kindOf = (item: FormItem): string => {
      const raw = toApiItem(item);
      if (raw === null) return "none";
      const question = raw.questionItem?.question;
      if (question === undefined)
        return Object.keys(raw).filter((k) => k.endsWith("Item"))[0] ?? "";
      return Object.keys(question).filter((k) => k.endsWith("Question"))[0] ?? "";
    };
    expect(items.map(kindOf)).toEqual([
      "choiceQuestion",
      "choiceQuestion",
      "choiceQuestion",
      "scaleQuestion",
      "textQuestion",
      "dateQuestion",
      "timeQuestion",
      // A file upload question reads, and is never written — see below.
      "none",
      "pageBreakItem",
      "textItem",
    ]);
  });

  /**
   * The generated types this repo ships say it outright: "A file upload
   * question. The API currently does not support creating file upload
   * questions." A `batchUpdate` is atomic, so one such item in a request kills
   * every other edit beside it — and on `create`, after the empty form already
   * exists. So no request carries one, on the same terms as an `unsupported`
   * item (0028 §2): it reads, it holds its position, and it is never sent.
   */
  it("builds no request for a file upload question, which the API cannot create", () => {
    expect(at(7).type).toBe("file_upload");
    expect(toApiItem(at(7))).toBeNull();
  });

  it("emits nothing at all for an item the schema could not model (0028 §2)", () => {
    expect(toApiItem({ type: "unsupported", raw: { videoItem: {} } })).toBeNull();
  });

  /** The kinds a request can carry at all — the two that cannot are asserted above. */
  const writable = items.filter((item) => toApiItem(item) !== null);

  /**
   * The property that keeps the two directions from drifting: whatever `read`
   * emitted, sending it back and reading it again is the same document. It runs
   * over the whole fixture set, so a kind added to one direction and not the
   * other fails here rather than in a form.
   *
   * {@link asWritten} is the one documented exception, and it is named rather
   * than quietly tolerated: an "Other" option's label cannot be sent, so a
   * write cannot preserve it and this property must not claim it does.
   */
  it("round-trips every writable item through the API shape unchanged", () => {
    expect(writable).toHaveLength(items.length - 1);
    for (const item of writable) {
      const raw = toApiItem(item);
      if (raw === null) throw new Error("filtered above");
      expect(toDocumentItem(raw)).toEqual(asWritten(item));
    }
  });

  /**
   * Whatever the first write normalizes away, a second one agrees with: reading
   * the form back and writing it again sends the same request. That is what
   * makes the exception above a normalization rather than a slow drift.
   */
  it("sends the same request again after a read of what it wrote", () => {
    for (const item of writable) {
      const once = toApiItem(item);
      if (once === null) throw new Error("filtered above");
      expect(toApiItem(toDocumentItem(once))).toEqual(once);
    }
  });

  it("keeps a hand-written item with no ids free of them", () => {
    const [item] = parseFormDocument("title: T\nitems:\n  - type: text\n    title: Name\n").items;
    expect(toApiItem(item ?? { type: "text" })).toEqual({
      title: "Name",
      questionItem: { question: { required: false, textQuestion: { paragraph: false } } },
    });
  });
});

/**
 * The mask is what stops an update from deleting what the document never
 * carried. `grading` is the case that matters: 0027 defers it, so it is absent
 * from every item this file builds, and a mask naming its parent would clear it
 * on the first write.
 */
describe("itemUpdateMask", () => {
  const raw = (index: number): ItemRaw => {
    const item = form.items?.[index];
    if (item === undefined) throw new Error(`no fixture item at ${index}`);
    return item;
  };
  const document = toFormDocument(form).document;
  const doc = (index: number): FormItem => {
    const item = document.items[index];
    if (item === undefined) throw new Error(`no fixture item at ${index}`);
    return item;
  };

  it("names the prose, the required flag and the question's own kind", () => {
    expect(itemUpdateMask(doc(0), raw(0)).split(",")).toEqual([
      "title",
      "description",
      "questionItem.question.required",
      "questionItem.question.choiceQuestion",
    ]);
  });

  it("never names a field the document does not carry", () => {
    for (const [index, item] of document.items.entries()) {
      const named = itemUpdateMask(item, raw(index)).split(",");
      expect(named).not.toContain("questionItem.question.grading");
      expect(named).not.toContain("questionItem.question");
      expect(named).not.toContain("questionItem");
      expect(named).not.toContain("questionItem.question.questionId");
      expect(named).not.toContain("itemId");
    }
  });

  it("names the kind an item is leaving, so a retyped item is not left with two", () => {
    // The scale question, rewritten in the document as a text question.
    const retyped: FormItem = { id: "i-scale", type: "text", title: "How satisfied?" };
    expect(itemUpdateMask(retyped, raw(3)).split(",")).toContain(
      "questionItem.question.scaleQuestion",
    );
  });

  it("clears the whole question when a question becomes something else", () => {
    const retyped: FormItem = { id: "i-scale", type: "page_break", title: "Section 2" };
    const named = itemUpdateMask(retyped, raw(3)).split(",");
    expect(named).toContain("pageBreakItem");
    expect(named).toContain("questionItem");
  });
});

describe("parseFormDocument", () => {
  it("accepts what formDocumentToYaml wrote", () => {
    const { document } = toFormDocument(form);
    expect(parseFormDocument(formDocumentToYaml(document))).toEqual(document);
  });

  it("accepts a hand-written document with no ids", () => {
    const document = parseFormDocument(
      "title: Quick poll\nitems:\n  - type: text\n    title: Name\n",
    );
    expect(document).toEqual({ title: "Quick poll", items: [{ type: "text", title: "Name" }] });
  });

  it("rejects a document whose item type is unknown", () => {
    expect(codeOf(() => parseFormDocument("title: T\nitems:\n  - type: video\n"))).toBe(
      "INVALID_ARGS",
    );
  });

  it("rejects input that is not a YAML mapping", () => {
    expect(codeOf(() => parseFormDocument("- 1\n- 2\n"))).toBe("INVALID_ARGS");
  });

  it("rejects input that is not YAML at all", () => {
    expect(codeOf(() => parseFormDocument("title: [unclosed\n"))).toBe("INVALID_ARGS");
  });
});
