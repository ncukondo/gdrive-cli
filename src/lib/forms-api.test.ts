import { describe, expect, it } from "vitest";
import { createFakeForms } from "../../tests/helpers/fake-forms.ts";
import { AppError } from "../types/index.ts";
import { toFormDocument, type FormRaw } from "./form-document.ts";
import {
  getForm,
  listResponses,
  responseGrid,
  tabulateResponses,
  type FormResponseRaw,
} from "./forms-api.ts";

/** The {@link AppError} code an awaited call raises. */
async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;
  }
  return "no error";
}

function googleError(code: number): Error & { code: number } {
  return Object.assign(new Error(`request failed with ${code}`), { code });
}

const form: FormRaw = {
  formId: "1FoRm",
  info: { title: "Survey" },
  items: [
    {
      itemId: "i1",
      title: "Which team are you on?",
      questionItem: {
        question: {
          questionId: "q1",
          choiceQuestion: { type: "RADIO", options: [{ value: "Sales" }] },
        },
      },
    },
    {
      itemId: "i2",
      title: "Which tools do you use?",
      questionItem: {
        question: {
          questionId: "q2",
          choiceQuestion: { type: "CHECKBOX", options: [{ value: "Docs" }] },
        },
      },
    },
    {
      itemId: "i3",
      title: "Attach your slides",
      questionItem: { question: { questionId: "q3", fileUploadQuestion: { folderId: "F" } } },
    },
  ],
};

describe("getForm", () => {
  it("requests the form and returns it", async () => {
    const fake = createFakeForms({ form });
    expect(await getForm(fake.client, "1FoRm")).toEqual(form);
    expect(fake.calls).toEqual(["forms.get"]);
  });

  it("surfaces a 404 as NOT_FOUND and a 403 as PERMISSION_DENIED", async () => {
    const missing = createFakeForms({ error: googleError(404) });
    expect(await codeOf(() => getForm(missing.client, "1FoRm"))).toBe("NOT_FOUND");
    const denied = createFakeForms({ error: googleError(403) });
    expect(await codeOf(() => getForm(denied.client, "1FoRm"))).toBe("PERMISSION_DENIED");
  });
});

describe("listResponses", () => {
  it("returns every response, following nextPageToken", async () => {
    const fake = createFakeForms({
      pages: [[{ responseId: "r1" }, { responseId: "r2" }], [{ responseId: "r3" }]],
    });
    const responses = await listResponses(fake.client, "1FoRm");
    expect(responses.map((r) => r.responseId)).toEqual(["r1", "r2", "r3"]);
    expect(fake.pageTokens).toEqual([undefined, "1"]);
  });

  it("maps its errors the same way, so a mid-page failure is not swallowed", async () => {
    const denied = createFakeForms({ error: googleError(403) });
    expect(await codeOf(() => listResponses(denied.client, "1FoRm"))).toBe("PERMISSION_DENIED");
    const missing = createFakeForms({ error: googleError(404) });
    expect(await codeOf(() => listResponses(missing.client, "1FoRm"))).toBe("NOT_FOUND");
  });

  it("returns an empty list for a form nobody has answered", async () => {
    const fake = createFakeForms({ pages: [[]] });
    expect(await listResponses(fake.client, "1FoRm")).toEqual([]);
    expect(fake.calls).toEqual(["forms.responses.list"]);
  });
});

describe("tabulateResponses", () => {
  const { document } = toFormDocument(form);

  const responses: FormResponseRaw[] = [
    {
      responseId: "r1",
      lastSubmittedTime: "2026-07-01T10:22:00Z",
      answers: {
        q1: { questionId: "q1", textAnswers: { answers: [{ value: "Sales" }] } },
        q2: {
          questionId: "q2",
          textAnswers: { answers: [{ value: "Docs" }, { value: "Sheets" }] },
        },
        q3: {
          questionId: "q3",
          fileUploadAnswers: { answers: [{ fileId: "1FiLe", fileName: "deck.pdf" }] },
        },
      },
    },
    { responseId: "r2", createTime: "2026-07-02T09:00:00Z", answers: {} },
  ];

  it("heads the table with `submitted` and one column per question", () => {
    const table = tabulateResponses(document, responses);
    expect(table.columns.map((c) => c.title)).toEqual([
      "submitted",
      "Which team are you on?",
      "Which tools do you use?",
      "Attach your slides",
    ]);
  });

  it("keeps a checkbox and a file-upload answer as arrays", () => {
    const [row] = tabulateResponses(document, responses).rows;
    expect(row).toEqual({
      submitted: "2026-07-01T10:22:00Z",
      "Which team are you on?": "Sales",
      "Which tools do you use?": ["Docs", "Sheets"],
      "Attach your slides": ["1FiLe"],
    });
  });

  it("leaves an unanswered question empty, keeping the column's shape", () => {
    const rows = tabulateResponses(document, responses).rows;
    expect(rows[1]).toEqual({
      submitted: "2026-07-02T09:00:00Z",
      "Which team are you on?": "",
      "Which tools do you use?": [],
      "Attach your slides": [],
    });
  });

  it("disambiguates two questions that share a title", () => {
    const duplicated: FormRaw = {
      info: { title: "Survey" },
      items: [
        {
          itemId: "a",
          title: "Name",
          questionItem: { question: { questionId: "qa", textQuestion: {} } },
        },
        {
          itemId: "b",
          title: "Name",
          questionItem: { question: { questionId: "qb", textQuestion: {} } },
        },
      ],
    };
    const table = tabulateResponses(toFormDocument(duplicated).document, []);
    expect(table.columns.map((c) => c.title)).toEqual(["submitted", "Name (qa)", "Name (qb)"]);
  });

  it("disambiguates a question titled like the submitted column", () => {
    const collides: FormRaw = {
      info: { title: "Survey" },
      items: [
        {
          itemId: "a",
          title: "submitted",
          questionItem: { question: { questionId: "qa", textQuestion: {} } },
        },
      ],
    };
    const table = tabulateResponses(toFormDocument(collides).document, []);
    expect(table.columns.map((c) => c.title)).toEqual(["submitted", "submitted (qa)"]);
  });

  it("titles an untitled question by its question id", () => {
    const untitled: FormRaw = {
      info: { title: "Survey" },
      items: [{ itemId: "a", questionItem: { question: { questionId: "qa", textQuestion: {} } } }],
    };
    const table = tabulateResponses(toFormDocument(untitled).document, []);
    expect(table.columns.map((c) => c.title)).toEqual(["submitted", "qa"]);
  });

  it("gives an unmodelled question a column, so its answers are not lost", () => {
    const rating: FormRaw = {
      info: { title: "Survey" },
      items: [
        {
          itemId: "a",
          title: "Rate us",
          questionItem: { question: { questionId: "qa", ratingQuestion: { ratingScaleLevel: 5 } } },
        },
      ],
    };
    const table = tabulateResponses(toFormDocument(rating).document, [
      { responseId: "r", answers: { qa: { textAnswers: { answers: [{ value: "4" }] } } } },
    ]);
    expect(table.columns.map((c) => c.title)).toEqual(["submitted", "Rate us"]);
    expect(table.rows[0]).toMatchObject({ "Rate us": "4" });
  });

  /**
   * A grid is one item holding several questions, each with its own id. The
   * document cannot model it, but the answers are keyed by those ids and are
   * as real as any other — so the table reads them out of `raw`.
   */
  describe("a grid (question group)", () => {
    const grid: FormRaw = {
      info: { title: "Survey" },
      items: [
        {
          itemId: "i0",
          title: "Name",
          questionItem: { question: { questionId: "q0", textQuestion: {} } },
        },
        {
          itemId: "i1",
          title: "Rate each area",
          questionGroupItem: {
            grid: { columns: { type: "RADIO", options: [{ value: "1" }, { value: "2" }] } },
            questions: [
              { questionId: "g1", rowQuestion: { title: "Speed" } },
              { questionId: "g2", rowQuestion: { title: "Support" } },
            ],
          },
        },
      ],
    };
    const answered: FormResponseRaw[] = [
      {
        responseId: "r1",
        lastSubmittedTime: "2026-07-01T10:00:00Z",
        answers: {
          q0: { textAnswers: { answers: [{ value: "Ann" }] } },
          g1: { textAnswers: { answers: [{ value: "2" }] } },
          g2: { textAnswers: { answers: [{ value: "1" }] } },
        },
      },
    ];

    it("gives each row its own column, named by the item and the row", () => {
      const table = tabulateResponses(toFormDocument(grid).document, answered);
      expect(table.columns.map((c) => c.title)).toEqual([
        "submitted",
        "Name",
        "Rate each area — Speed",
        "Rate each area — Support",
      ]);
    });

    it("does not lose the answers to those rows", () => {
      const table = tabulateResponses(toFormDocument(grid).document, answered);
      expect(table.rows[0]).toEqual({
        submitted: "2026-07-01T10:00:00Z",
        Name: "Ann",
        "Rate each area — Speed": "2",
        "Rate each area — Support": "1",
      });
    });

    it("keeps a checkbox grid's answers as arrays", () => {
      const checkboxGrid: FormRaw = {
        info: { title: "Survey" },
        items: [
          {
            itemId: "i1",
            title: "Which apply?",
            questionGroupItem: {
              grid: { columns: { type: "CHECKBOX" } },
              questions: [{ questionId: "g1", rowQuestion: { title: "Row" } }],
            },
          },
        ],
      };
      const table = tabulateResponses(toFormDocument(checkboxGrid).document, [
        { responseId: "r", answers: { g1: { textAnswers: { answers: [{ value: "a" }] } } } },
      ]);
      expect(table.rows[0]).toMatchObject({ "Which apply? — Row": ["a"] });
    });

    /**
     * A grid's columns are a `ChoiceQuestion` like any other, so the two
     * places that read `ChoiceQuestion.type` must answer alike. They did not:
     * one accepted `CHECK_BOX`, the other only `CHECKBOX`, so the same form
     * would have read one way as a question and another as a grid.
     */
    it.each(["CHECKBOX", "RADIO", "DROP_DOWN", "CHECK_BOX"])(
      "reads `%s` the same way as a grid and as a plain question",
      (apiType) => {
        const asQuestion: FormRaw = {
          info: { title: "Survey" },
          items: [
            {
              itemId: "i1",
              title: "Q",
              questionItem: {
                question: { questionId: "q1", choiceQuestion: { type: apiType } },
              },
            },
          ],
        };
        const asGrid: FormRaw = {
          info: { title: "Survey" },
          items: [
            {
              itemId: "i1",
              title: "Q",
              questionGroupItem: {
                grid: { columns: { type: apiType } },
                questions: [{ questionId: "q1", rowQuestion: { title: "Row" } }],
              },
            },
          ],
        };
        const [, question] = tabulateResponses(toFormDocument(asQuestion).document, []).columns;
        const [, row] = tabulateResponses(toFormDocument(asGrid).document, []).columns;
        expect(row?.multi).toBe(question?.multi);
      },
    );

    it("falls back to the row's question id when nothing is titled", () => {
      const untitled: FormRaw = {
        info: { title: "Survey" },
        items: [{ itemId: "i1", questionGroupItem: { questions: [{ questionId: "g1" }] } }],
      };
      const table = tabulateResponses(toFormDocument(untitled).document, []);
      expect(table.columns.map((c) => c.title)).toEqual(["submitted", "g1"]);
    });
  });

  it("keeps every column title distinct, so no row value can overwrite another", () => {
    // A question titled exactly like the disambiguation of another pair.
    const adversarial: FormRaw = {
      info: { title: "Survey" },
      items: [
        {
          itemId: "a",
          title: "Name",
          questionItem: { question: { questionId: "qa", textQuestion: {} } },
        },
        {
          itemId: "b",
          title: "Name",
          questionItem: { question: { questionId: "qb", textQuestion: {} } },
        },
        {
          itemId: "c",
          title: "Name (qb)",
          questionItem: { question: { questionId: "qc", textQuestion: {} } },
        },
      ],
    };
    const titles = tabulateResponses(toFormDocument(adversarial).document, []).columns.map(
      (c) => c.title,
    );
    expect(new Set(titles).size).toBe(titles.length);
  });

  /**
   * The suffix rule separates two columns by their question ids, so it cannot
   * separate two that share one. A grid listing the same `questionId` twice is
   * malformed, but it is what a table keyed by title needs a final guarantee
   * against: without one, the second row's answer overwrites the first's.
   */
  it("keeps titles distinct even when two columns share a question id", () => {
    const repeated: FormRaw = {
      info: { title: "Survey" },
      items: [
        {
          itemId: "i1",
          title: "Rate",
          questionGroupItem: {
            questions: [
              { questionId: "g1", rowQuestion: { title: "Row" } },
              { questionId: "g1", rowQuestion: { title: "Row" } },
            ],
          },
        },
      ],
    };
    const table = tabulateResponses(toFormDocument(repeated).document, [
      { responseId: "r", answers: { g1: { textAnswers: { answers: [{ value: "3" }] } } } },
    ]);
    const titles = table.columns.map((c) => c.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(Object.keys(table.rows[0] ?? {})).toHaveLength(titles.length);
  });

  it("gives a page break or a text block no column", () => {
    const sections: FormRaw = {
      info: { title: "Survey" },
      items: [{ itemId: "a", title: "Section 2", pageBreakItem: {} }],
    };
    expect(tabulateResponses(toFormDocument(sections).document, []).columns).toHaveLength(1);
  });
});

describe("responseGrid", () => {
  it("joins multi-valued cells with '; ' under a header row", () => {
    const { document } = toFormDocument(form);
    const table = tabulateResponses(document, [
      {
        responseId: "r1",
        lastSubmittedTime: "2026-07-01T10:22:00Z",
        answers: {
          q2: { textAnswers: { answers: [{ value: "Docs" }, { value: "Sheets" }] } },
        },
      },
    ]);
    expect(responseGrid(table)).toEqual([
      ["submitted", "Which team are you on?", "Which tools do you use?", "Attach your slides"],
      ["2026-07-01T10:22:00Z", "", "Docs; Sheets", ""],
    ]);
  });

  it("is the header alone when nobody has answered", () => {
    const table = tabulateResponses(toFormDocument(form).document, []);
    expect(responseGrid(table)).toHaveLength(1);
  });
});
