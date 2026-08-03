import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { AppError } from "../types/index.ts";
import {
  formDocumentToYaml,
  parseFormDocument,
  toFormDocument,
  type FormRaw,
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
            options: [{ value: "Docs" }, { value: "Sheets", goToAction: "NEXT_SECTION" }],
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
      options: ["Docs", { value: "Sheets", go_to_action: "NEXT_SECTION" }],
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

describe("formDocumentToYaml", () => {
  it("round-trips through a YAML parser unchanged", () => {
    const { document } = toFormDocument(form);
    expect(YAML.parse(formDocumentToYaml(document))).toEqual(document);
  });

  it("writes multi-line prose as a block scalar rather than escapes", () => {
    const { document } = toFormDocument(form);
    expect(formDocumentToYaml(document)).toContain("description: |-\n  Takes about five minutes.");
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
