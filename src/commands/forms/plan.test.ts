import { describe, expect, it } from "vitest";
import { AppError } from "../../types/index.ts";
import { parseFormDocument, toFormDocument, type FormRaw } from "../../lib/form-document.ts";
import { planFormCreate, planFormWrite, type FormPlan } from "./plan.ts";

/** The {@link AppError} code a call raises, without asserting on the error. */
function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;
  }
  return "no error";
}

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

/** Three items, the middle one a kind the schema cannot model (0027 §4). */
const form: FormRaw = {
  formId: "1FoRm",
  info: { title: "Survey", description: "Takes five minutes." },
  revisionId: "00000007",
  items: [
    {
      itemId: "i1",
      title: "Which team are you on?",
      questionItem: {
        question: {
          questionId: "q1",
          required: true,
          choiceQuestion: { type: "RADIO", options: [{ value: "Sales" }] },
        },
      },
    },
    { itemId: "i2", title: "Watch this", videoItem: { video: { youtubeUri: "https://y" } } },
    {
      itemId: "i3",
      title: "Anything else?",
      questionItem: { question: { questionId: "q3", textQuestion: { paragraph: true } } },
    },
  ],
};

const { document } = toFormDocument(form);

/** The document as `read` emitted it, with one node replaced. */
function edited(change: (items: typeof document.items) => typeof document.items) {
  return { ...document, items: change([...document.items]) };
}

const plan = (doc: typeof document, prune = false): FormPlan => planFormWrite(form, doc, { prune });

describe("planFormWrite", () => {
  it("plans nothing at all for the document the form itself produced", () => {
    const result = plan(document);
    expect(result.requests).toEqual([]);
    expect(result.entries).toEqual([]);
  });

  it("updates an item in place when its id matches (0028 §1)", () => {
    const result = plan(
      edited((items) => {
        const [first, ...rest] = items;
        if (first?.type !== "choice") throw new Error("fixture");
        return [{ ...first, title: "Which team do you work in?" }, ...rest];
      }),
    );
    expect(result.entries).toEqual([
      { action: "update", id: "i1", title: "Which team do you work in?", index: 0 },
    ]);
    const [request] = result.requests;
    expect(request).toMatchObject({
      updateItem: { location: { index: 0 }, item: { title: "Which team do you work in?" } },
    });
  });

  it("never lets an update name the question id or the grading it cannot carry", () => {
    const result = plan(
      edited((items) => {
        const [first, ...rest] = items;
        if (first?.type !== "choice") throw new Error("fixture");
        return [{ ...first, required: false }, ...rest];
      }),
    );
    const [request] = result.requests;
    const mask =
      request !== undefined && "updateItem" in request ? request.updateItem.updateMask : "";
    expect(mask.split(",")).not.toContain("questionItem.question");
    expect(mask.split(",")).toContain("questionItem.question.required");
  });

  it("creates an item with no id at the position it holds in the document", () => {
    const result = plan(
      edited((items) => {
        const [first, ...rest] = items;
        if (first === undefined) throw new Error("fixture");
        return [first, { type: "text", title: "Your name" }, ...rest];
      }),
    );
    expect(result.entries).toEqual([{ action: "create", title: "Your name", index: 1 }]);
    expect(result.requests).toEqual([
      {
        createItem: {
          item: {
            title: "Your name",
            questionItem: { question: { required: false, textQuestion: { paragraph: false } } },
          },
          location: { index: 1 },
        },
      },
    ]);
  });

  /**
   * Read-only fields are ignored rather than rejected (0028 §6). A `question_id`
   * left on an item that has no `id` — a node copied from another form — must
   * not travel into the create, where the API would take it as the id to use.
   */
  it("leaves a question id off an item it is creating", () => {
    const doc = parseFormDocument(
      [
        "title: Survey",
        "description: Takes five minutes.",
        "items:",
        "  - question_id: q-from-elsewhere",
        "    type: text",
        "    title: Your name",
      ].join("\n"),
    );
    const empty: FormRaw = { info: { title: "Survey", description: "Takes five minutes." } };
    const result = planFormWrite(empty, doc, { prune: true });
    expect(result.requests).toEqual([
      {
        createItem: {
          item: {
            title: "Your name",
            questionItem: { question: { required: false, textQuestion: { paragraph: false } } },
          },
          location: { index: 0 },
        },
      },
    ]);
  });

  it("moves an item the document reordered, counting the positions the form has", () => {
    const result = plan(
      edited((items) => {
        const [first, second, third] = items;
        if (first === undefined || second === undefined || third === undefined) {
          throw new Error("fixture");
        }
        return [first, third, second];
      }),
    );
    expect(result.entries).toEqual([
      { action: "move", id: "i3", title: "Anything else?", from: 2, index: 1 },
    ]);
    expect(result.requests).toEqual([
      { moveItem: { originalLocation: { index: 2 }, newLocation: { index: 1 } } },
    ]);
  });

  /** 0028 §2, which 0027 §4's round trip depends on. */
  it("emits no request for an item the schema could not model, only a position", () => {
    const result = plan(
      edited((items) => {
        const [first, second, third] = items;
        if (second?.type !== "unsupported" || first === undefined || third === undefined) {
          throw new Error("fixture");
        }
        // An edit to the legible echo beside `raw` changes nothing in the form.
        return [first, { ...second, title: "Renamed" }, third];
      }),
    );
    expect(result.requests).toEqual([]);
  });

  it("refuses to delete without --prune, naming the items and the flag (0028 §3)", () => {
    const shorter = edited((items) => items.slice(0, 2));
    expect(codeOf(() => plan(shorter))).toBe("PRUNE_REQUIRED");
    const message = messageOf(() => plan(shorter));
    expect(message).toContain("Anything else?");
    expect(message).toContain("i3");
    expect(message).toContain("--prune");
  });

  it("hands back no partial plan a caller could apply instead", () => {
    // The same document also renames an item, so there *is* something that
    // could have been applied: 0028 §3 says the plan is built whole or not at
    // all, so the caller never receives the creates and updates on their own.
    const shorter = edited((items) => {
      const [first] = items;
      if (first?.type !== "choice") throw new Error("fixture");
      return [{ ...first, title: "Renamed" }];
    });
    expect(codeOf(() => plan(shorter))).toBe("PRUNE_REQUIRED");
  });

  it("deletes with --prune, last position first so the indices stay valid", () => {
    const shorter = edited((items) => items.slice(0, 1));
    const result = plan(shorter, true);
    expect(result.entries).toEqual([
      { action: "delete", id: "i2", title: "Watch this", index: 1 },
      { action: "delete", id: "i3", title: "Anything else?", index: 2 },
    ]);
    expect(result.requests).toEqual([
      { deleteItem: { location: { index: 2 } } },
      { deleteItem: { location: { index: 1 } } },
    ]);
  });

  it("plans a create against the positions a deletion left behind", () => {
    const result = plan(
      edited((items) => {
        const [, , third] = items;
        if (third === undefined) throw new Error("fixture");
        return [third, { type: "text", title: "Your name" }];
      }),
      true,
    );
    expect(result.entries).toEqual([
      { action: "delete", id: "i1", title: "Which team are you on?", index: 0 },
      { action: "delete", id: "i2", title: "Watch this", index: 1 },
      { action: "create", title: "Your name", index: 1 },
    ]);
    expect(result.requests).toEqual([
      { deleteItem: { location: { index: 1 } } },
      { deleteItem: { location: { index: 0 } } },
      {
        createItem: {
          item: {
            title: "Your name",
            questionItem: { question: { required: false, textQuestion: { paragraph: false } } },
          },
          location: { index: 1 },
        },
      },
    ]);
  });

  it("treats an id the form does not have as an error, not as a create (0028 §1)", () => {
    const doc = edited((items) => {
      const [first, ...rest] = items;
      if (first?.type !== "choice") throw new Error("fixture");
      return [{ ...first, id: "i-elsewhere" }, ...rest];
    });
    expect(codeOf(() => plan(doc, true))).toBe("INVALID_ARGS");
    expect(messageOf(() => plan(doc, true))).toContain("i-elsewhere");
  });

  it("refuses a document naming the same item twice", () => {
    const doc = edited((items) => {
      const [first] = items;
      if (first === undefined) throw new Error("fixture");
      return [first, first];
    });
    expect(codeOf(() => plan(doc, true))).toBe("INVALID_ARGS");
  });

  /**
   * The mask names `description` even when the document has none, because the
   * document is the desired state for the fields it *does* model. Nothing about
   * settings is ever sent: the document carries none, and an `updateSettings`
   * derived from it would say `isQuiz: false` and delete every question's
   * grading.
   */
  it("updates the form's own title and description, and nothing about its settings", () => {
    const { description: _, ...withoutDescription } = document;
    const result = plan({ ...withoutDescription, title: "2027 survey" });
    expect(result.entries).toEqual([{ action: "form_info", title: "2027 survey" }]);
    expect(result.requests).toEqual([
      { updateFormInfo: { info: { title: "2027 survey" }, updateMask: "title,description" } },
    ]);
  });

  it("skips an unmodelled item the document asked to add, since none can be made", () => {
    const result = plan(
      edited((items) => [...items, { type: "unsupported", title: "A video", raw: {} }]),
    );
    expect(result.requests).toEqual([]);
    expect(result.skipped).toEqual([{ index: 3, title: "A video", kind: "unsupported" }]);
  });

  /**
   * "The API currently does not support creating file upload questions", says
   * the generated type this repo ships. A `batchUpdate` is atomic, so letting
   * one into a request takes every other edit down with it.
   */
  it("skips a file upload question the document asked to add, and keeps the rest", () => {
    const result = plan(
      edited((items) => {
        const [first, ...rest] = items;
        if (first === undefined) throw new Error("fixture");
        return [
          first,
          { type: "file_upload", title: "Attach your slides", folder_id: "1F" },
          { type: "text", title: "Your name" },
          ...rest,
        ];
      }),
    );
    expect(result.skipped).toEqual([
      { index: 1, title: "Attach your slides", kind: "fileUploadQuestion" },
    ]);
    // The item that cannot be made holds no position, so the one after it lands
    // where the rest of the document does.
    expect(result.entries).toEqual([{ action: "create", title: "Your name", index: 1 }]);
    expect(result.requests).toEqual([
      {
        createItem: {
          item: {
            title: "Your name",
            questionItem: { question: { required: false, textQuestion: { paragraph: false } } },
          },
          location: { index: 1 },
        },
      },
    ]);
  });
});

describe("planFormCreate", () => {
  it("creates every item in order, ignoring the ids the document came with", () => {
    const result = planFormCreate(document, "Copy of Survey");
    expect(result.entries.map((entry) => entry.action)).toEqual(["form_info", "create", "create"]);
    expect(result.entries.filter((entry) => entry.action === "create")).toEqual([
      { action: "create", title: "Which team are you on?", index: 0 },
      { action: "create", title: "Anything else?", index: 1 },
    ]);
    for (const request of result.requests) {
      if (!("createItem" in request)) continue;
      expect(request.createItem.item.itemId).toBeUndefined();
      expect(request.createItem.item.questionItem?.question.questionId).toBeUndefined();
    }
  });

  it("takes its title from the argument and its description from the document", () => {
    const result = planFormCreate(document, "Copy of Survey");
    expect(result.requests[0]).toEqual({
      updateFormInfo: {
        info: { title: "Copy of Survey", description: "Takes five minutes." },
        updateMask: "title,description",
      },
    });
  });

  it("reports the unmodelled items it could not carry over", () => {
    expect(planFormCreate(document, "Copy").skipped).toEqual([
      { index: 1, title: "Watch this", kind: "unsupported" },
    ]);
  });

  it("plans only the title for a document with nothing but one", () => {
    expect(planFormCreate({ title: "Empty", items: [] }, "Empty").requests).toEqual([]);
  });

  /**
   * `go_to_section_id` is an item id — "Item ID of section header to go to",
   * says the generated type — and it names an item of the form the document was
   * *read* from. A new form has none of those ids, so copying one over sends
   * navigation that points at nothing, which is exactly what 0028 §1 refuses to
   * do with `id` itself. `go_to_action` is not an id and travels fine.
   */
  it("drops section navigation, whose target belongs to the form it was read from", () => {
    const branching: FormRaw = {
      info: { title: "Branching" },
      items: [
        {
          itemId: "i-branch",
          title: "Which team are you on?",
          questionItem: {
            question: {
              questionId: "q-branch",
              choiceQuestion: {
                type: "RADIO",
                options: [
                  { value: "Sales", goToSectionId: "i-page" },
                  { value: "Engineering", goToAction: "NEXT_SECTION" },
                ],
              },
            },
          },
        },
        { itemId: "i-page", title: "Sales", pageBreakItem: {} },
      ],
    };
    const source = toFormDocument(branching).document;
    const result = planFormCreate(source, "Copy");

    const [created] = result.requests.filter((request) => "createItem" in request);
    const options =
      created !== undefined && "createItem" in created
        ? created.createItem.item.questionItem?.question.choiceQuestion?.options
        : [];
    expect(options).toEqual([
      { value: "Sales" },
      { value: "Engineering", goToAction: "NEXT_SECTION" },
    ]);
    expect(result.skipped).toEqual([
      { index: 0, title: "Which team are you on?", kind: "option.goToSectionId" },
    ]);
  });

  /** A write is a different matter: those ids name items the form really has. */
  it("keeps section navigation on a write, where the target is in the same form", () => {
    const branching: FormRaw = {
      info: { title: "Branching" },
      items: [{ itemId: "i-page", title: "Sales", pageBreakItem: {} }],
    };
    const added = parseFormDocument(
      [
        "title: Branching",
        "items:",
        "  - type: choice",
        "    choice_type: radio",
        "    title: Which team?",
        "    options:",
        "      - value: Sales",
        "        go_to_section_id: i-page",
        "  - id: i-page",
        "    type: page_break",
        "    title: Sales",
      ].join("\n"),
    );
    const result = planFormWrite(branching, added, { prune: false });
    const [created] = result.requests.filter((request) => "createItem" in request);
    const options =
      created !== undefined && "createItem" in created
        ? created.createItem.item.questionItem?.question.choiceQuestion?.options
        : [];
    expect(options).toEqual([{ value: "Sales", goToSectionId: "i-page" }]);
    expect(result.skipped).toEqual([]);
  });
});
