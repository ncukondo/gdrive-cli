import { describe, expect, it, vi } from "vitest";
import { createFakeForms } from "../../../tests/helpers/fake-forms.ts";
import type { FormRaw } from "../../lib/form-document.ts";
import { getForm, listResponses, type FormResponseRaw } from "../../lib/forms-api.ts";
import { handleFormsResponses } from "./responses.ts";

function collect() {
  const lines: string[] = [];
  return {
    write: (m: string) => lines.push(m),
    get output() {
      return lines.join("\n");
    },
  };
}

/** A radio, a checkbox and a file upload — the three answer shapes. */
const form: FormRaw = {
  formId: "1FoRm",
  info: { title: "2026 Engagement survey" },
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
      title: "Which tools, roughly?",
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

const responses: FormResponseRaw[] = [
  {
    responseId: "r1",
    lastSubmittedTime: "2026-07-01T10:22:00Z",
    answers: {
      q1: { textAnswers: { answers: [{ value: "Sales" }] } },
      q2: { textAnswers: { answers: [{ value: "Docs" }, { value: "Sheets" }] } },
      q3: { fileUploadAnswers: { answers: [{ fileId: "1FiLe" }, { fileId: "2FiLe" }] } },
    },
  },
  {
    responseId: "r2",
    lastSubmittedTime: "2026-07-01T11:05:00Z",
    answers: { q1: { textAnswers: { answers: [{ value: "Engineering" }] } } },
  },
];

function deps(overrides: {
  form?: FormRaw;
  responses?: FormResponseRaw[];
  as?: string;
  format?: "text" | "json";
  quiet?: boolean;
  write: (msg: string) => void;
  warn?: (msg: string) => void;
}) {
  return {
    resolvePath: async () => "1FoRm",
    getForm: async () => overrides.form ?? form,
    listResponses: async () => overrides.responses ?? responses,
    file: "Surveys/2026",
    format: overrides.format ?? ("text" as const),
    quiet: overrides.quiet ?? false,
    write: overrides.write,
    warn: overrides.warn ?? (() => {}),
    ...(overrides.as !== undefined ? { as: overrides.as } : {}),
  };
}

/** One item the schema cannot model, holding two questions of its own. */
const withGrid: FormRaw = {
  formId: "1FoRm",
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
        grid: { columns: { type: "RADIO" } },
        questions: [
          { questionId: "g1", rowQuestion: { title: "Speed" } },
          { questionId: "g2", rowQuestion: { title: "Support" } },
        ],
      },
    },
  ],
};

const gridResponses: FormResponseRaw[] = [
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

describe("handleFormsResponses", () => {
  it("fetches the form and the responses the argument resolved to", async () => {
    const resolvePath = vi.fn(async () => "1FoRm");
    const getForm = vi.fn(async () => form);
    const listResponses = vi.fn(async () => responses);
    const out = collect();
    await handleFormsResponses({
      resolvePath,
      getForm,
      listResponses,
      file: "Surveys/2026",
      format: "text",
      quiet: false,
      write: out.write,
      warn: () => {},
    });
    expect(resolvePath).toHaveBeenCalledWith("Surveys/2026");
    expect(getForm).toHaveBeenCalledWith("1FoRm");
    expect(listResponses).toHaveBeenCalledWith("1FoRm");
  });

  /**
   * Acceptance criterion 5. The linked spreadsheet is reported by `read` and
   * is otherwise nothing to do with this command — which is exactly why it
   * needs a fixture that has one, so that staying true stays checked.
   */
  it("returns the responses whether or not the form has a linked sheet", async () => {
    const linked = collect();
    const unlinked = collect();
    await handleFormsResponses(
      deps({ write: linked.write, form: { ...form, linkedSheetId: "1ShEeT" }, as: "csv" }),
    );
    await handleFormsResponses(deps({ write: unlinked.write, as: "csv" }));
    expect(linked.output).toBe(unlinked.output);
    expect(linked.output.split("\n")).toHaveLength(3);
  });

  it("heads the table with the question titles and a submitted column", async () => {
    const out = collect();
    await handleFormsResponses(deps({ write: out.write }));
    const [header, first] = out.output.split("\n");
    expect(header?.split("\t")).toEqual([
      "submitted",
      "Which team are you on?",
      "Which tools, roughly?",
      "Attach your slides",
    ]);
    expect(first?.split("\t")).toEqual([
      "2026-07-01T10:22:00Z",
      "Sales",
      "Docs; Sheets",
      "1FiLe; 2FiLe",
    ]);
  });

  it("leaves an unanswered question as an empty cell", async () => {
    const out = collect();
    await handleFormsResponses(deps({ write: out.write, as: "csv" }));
    expect(out.output.split("\n")[2]).toBe("2026-07-01T11:05:00Z,Engineering,,");
  });

  it("quotes a CSV field that contains a comma", async () => {
    const out = collect();
    await handleFormsResponses(deps({ write: out.write, as: "csv" }));
    const [header] = out.output.split("\n");
    expect(header).toBe(
      'submitted,Which team are you on?,"Which tools, roughly?",Attach your slides',
    );
  });

  it("keeps checkbox and file-upload answers as arrays in JSON", async () => {
    const out = collect();
    await handleFormsResponses(deps({ write: out.write, as: "json" }));
    expect(JSON.parse(out.output)).toEqual([
      {
        submitted: "2026-07-01T10:22:00Z",
        "Which team are you on?": "Sales",
        "Which tools, roughly?": ["Docs", "Sheets"],
        "Attach your slides": ["1FiLe", "2FiLe"],
      },
      {
        submitted: "2026-07-01T11:05:00Z",
        "Which team are you on?": "Engineering",
        "Which tools, roughly?": [],
        "Attach your slides": [],
      },
    ]);
  });

  it("appends the question id when two questions share a title", async () => {
    const duplicated: FormRaw = {
      formId: "1FoRm",
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
    const out = collect();
    await handleFormsResponses(
      deps({ write: out.write, form: duplicated, responses: [], as: "csv" }),
    );
    expect(out.output).toBe("submitted,Name (qa),Name (qb)");
  });

  it("prints a header-only table for a form nobody has answered", async () => {
    const out = collect();
    await handleFormsResponses(deps({ write: out.write, responses: [] }));
    expect(out.output.split("\n")).toHaveLength(1);
  });

  it("reports an empty array in JSON for a form nobody has answered", async () => {
    const out = collect();
    await handleFormsResponses(deps({ write: out.write, responses: [], format: "json" }));
    expect(JSON.parse(out.output)).toEqual({
      success: true,
      data: {
        id: "1FoRm",
        columns: [
          "submitted",
          "Which team are you on?",
          "Which tools, roughly?",
          "Attach your slides",
        ],
        responses: [],
        count: 0,
      },
    });
  });

  it("puts the rows in data.responses for JSON callers", async () => {
    const out = collect();
    await handleFormsResponses(deps({ write: out.write, format: "json" }));
    const { data } = JSON.parse(out.output);
    expect(data.count).toBe(2);
    expect(data.responses[0]["Which tools, roughly?"]).toEqual(["Docs", "Sheets"]);
  });

  it("prints CSV in quiet mode", async () => {
    const out = collect();
    await handleFormsResponses(deps({ write: out.write, quiet: true }));
    expect(out.output.split("\n")[1]).toBe("2026-07-01T10:22:00Z,Sales,Docs; Sheets,1FiLe; 2FiLe");
  });

  it("tabulates a grid's rows rather than dropping them", async () => {
    const out = collect();
    await handleFormsResponses(
      deps({ write: out.write, form: withGrid, responses: gridResponses, as: "csv" }),
    );
    expect(out.output.split("\n")).toEqual([
      "submitted,Name,Rate each area — Speed,Rate each area — Support",
      "2026-07-01T10:00:00Z,Ann,2,1",
    ]);
  });

  it("warns about an item it could not model, like `forms read` does", async () => {
    const out = collect();
    const warnings: string[] = [];
    await handleFormsResponses(
      deps({ write: out.write, warn: (m) => warnings.push(m), form: withGrid, responses: [] }),
    );
    expect(warnings).toEqual(["Kept as raw: questionGroupItem (item i1)"]);
  });

  it("reports the same items in data.unsupported instead, in JSON", async () => {
    const out = collect();
    const warnings: string[] = [];
    await handleFormsResponses(
      deps({
        write: out.write,
        warn: (m) => warnings.push(m),
        form: withGrid,
        responses: [],
        format: "json",
      }),
    );
    expect(warnings).toEqual([]);
    expect(JSON.parse(out.output).data.unsupported).toEqual([
      { id: "i1", kind: "questionGroupItem" },
    ]);
  });

  it("rejects an unknown --as", async () => {
    const out = collect();
    await expect(handleFormsResponses(deps({ write: out.write, as: "yaml" }))).rejects.toThrow(
      /Invalid --as/,
    );
  });

  it("costs exactly the two API calls decision 0027 §6 states", async () => {
    const fake = createFakeForms({ form, pages: [responses] });
    const out = collect();
    await handleFormsResponses({
      resolvePath: async () => "1FoRm",
      getForm: (id) => getForm(fake.client, id),
      listResponses: (id) => listResponses(fake.client, id),
      file: "Surveys/2026",
      format: "text",
      quiet: false,
      write: out.write,
      warn: () => {},
    });
    expect(fake.calls).toEqual(["forms.get", "forms.responses.list"]);
  });
});
