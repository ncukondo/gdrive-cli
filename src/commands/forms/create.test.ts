import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../types/index.ts";
import { formDocumentToYaml, toFormDocument, type FormRaw } from "../../lib/form-document.ts";
import type { FormsRequest } from "../../lib/forms-api.ts";
import { handleFormsCreate, type FormsCreateDeps } from "./create.ts";
import { childrenNamed, ROOT_ID } from "../../lib/resolve-path.ts";
import { createWritableTreeDrive, type DriveNode } from "../../../tests/helpers/fake-drive.ts";
import { UNPATHABLE_NAMES } from "../../../tests/helpers/names.ts";

function collect() {
  const lines: string[] = [];
  return {
    write: (m: string) => lines.push(m),
    get output() {
      return lines.join("\n");
    },
  };
}

/** A form as `forms read` emits it: every item already carries an id. */
const source: FormRaw = {
  formId: "1OlD",
  info: { title: "2026 Engagement survey", description: "Takes five minutes." },
  revisionId: "00000007",
  items: [
    {
      itemId: "i1",
      title: "Which team are you on?",
      questionItem: {
        question: {
          questionId: "q1",
          required: true,
          choiceQuestion: {
            type: "RADIO",
            // `goToSectionId` is an item id like any other, and it names an
            // item of *this* form — the one being copied from.
            options: [{ value: "Sales", goToSectionId: "i3" }],
          },
        },
      },
    },
    { itemId: "i2", title: "Watch this", videoItem: { video: { youtubeUri: "https://y" } } },
    { itemId: "i3", title: "Sales", pageBreakItem: {} },
  ],
};

/** Every id the source form has, whatever field it appears in. */
const SOURCE_IDS = ["i1", "i2", "i3", "q1", "1OlD"];

const yaml = formDocumentToYaml(toFormDocument(source).document);

interface Run {
  output: string;
  warnings: string[];
  batches: { formId: string; requests: FormsRequest[] }[];
  moves: { formId: string; parentId: string }[];
  created: string[];
  error?: unknown;
}

async function run(options: Partial<FormsCreateDeps> = {}): Promise<Run> {
  const out = collect();
  const warnings: string[] = [];
  const batches: Run["batches"] = [];
  const moves: Run["moves"] = [];
  const created: string[] = [];

  const deps: FormsCreateDeps = {
    resolvePath: async () => "1FoLdEr",
    createForm: async (title) => {
      created.push(title);
      return { id: "1NeW", title };
    },
    batchUpdate: async (formId, requests) => {
      batches.push({ formId, requests });
    },
    moveFile: async (formId, parentId) => {
      moves.push({ formId, parentId });
      return {};
    },
    findSiblings: async () => [],
    readInput: async () => yaml,
    title: "New survey",
    format: "json",
    quiet: false,
    write: out.write,
    warn: (m) => warnings.push(m),
    ...options,
  };

  try {
    await handleFormsCreate(deps);
  } catch (error) {
    return { output: out.output, warnings, batches, moves, created, error };
  }
  return { output: out.output, warnings, batches, moves, created };
}

const codeOf = (error: unknown): string =>
  error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;

describe("handleFormsCreate", () => {
  it("creates an empty form from a title alone, with no batch at all", async () => {
    const result = await run();
    expect(result.created).toEqual(["New survey"]);
    expect(result.batches).toEqual([]);
    expect(JSON.parse(result.output).data).toEqual({ id: "1NeW", title: "New survey" });
  });

  it("creates the form and then fills it in one batch (decision 0028 §7)", async () => {
    const result = await run({ source: "form.yaml" });
    expect(result.created).toEqual(["New survey"]);
    expect(result.batches).toHaveLength(1);
    expect(result.batches[0]?.formId).toBe("1NeW");
  });

  /**
   * Every id in the document belongs to the form it was read from, so the new
   * form takes none of them (0028 §6) — which is what makes `forms read A` into
   * `forms create B --file` a copy rather than an error about unknown ids.
   *
   * Asserted over the whole request body rather than field by field, because a
   * list of the fields this code calls "an id" is a list this code wrote: it
   * agreed with itself about `itemId` and `questionId` while sending the source
   * form's `goToSectionId` straight through.
   */
  it("sends no id belonging to the form the document was read from", async () => {
    const result = await run({ source: "form.yaml" });
    const body = JSON.stringify(result.batches[0]?.requests ?? []);
    for (const id of SOURCE_IDS) expect(body).not.toContain(id);
  });

  it("creates the items themselves, keeping what is not an id", async () => {
    const result = await run({ source: "form.yaml" });
    const creates = (result.batches[0]?.requests ?? []).filter(
      (request) => "createItem" in request,
    );
    // The choice question and the page break; the video item cannot be made.
    expect(creates).toHaveLength(2);
    const [first] = creates;
    if (first === undefined || !("createItem" in first)) throw new Error("fixture");
    expect(first.createItem.item.questionItem?.question.choiceQuestion?.options).toEqual([
      { value: "Sales" },
    ]);
  });

  it("takes the title from the argument and the description from the document", async () => {
    const result = await run({ source: "form.yaml" });
    const [request] = result.batches[0]?.requests ?? [];
    expect(request).toEqual({
      updateFormInfo: {
        info: { title: "New survey", description: "Takes five minutes." },
        updateMask: "title,description",
      },
    });
  });

  it("reports what it could not carry over, and why", async () => {
    const json = await run({ source: "form.yaml" });
    expect(JSON.parse(json.output).data.unsupported).toEqual([
      { index: 0, title: "Which team are you on?", kind: "option.goToSectionId" },
      { index: 1, title: "Watch this", kind: "unsupported" },
    ]);
    const text = await run({ source: "form.yaml", format: "text" });
    expect(text.warnings).toEqual([
      "Not written: Which team are you on? (document item 0): section navigation points at the form it was read from, Watch this (document item 1): not modelled, and `raw` is the API's shape rather than a request's",
    ]);
  });

  it("moves the form into --parent afterwards and reports the folder", async () => {
    const resolvePath = vi.fn(async () => "1FoLdEr");
    const result = await run({ parent: "Surveys", resolvePath });
    expect(resolvePath).toHaveBeenCalledWith("Surveys");
    expect(result.moves).toEqual([{ formId: "1NeW", parentId: "1FoLdEr" }]);
    expect(JSON.parse(result.output).data.parent_id).toBe("1FoLdEr");
  });

  it("names the new form in text mode", async () => {
    const result = await run({ format: "text" });
    expect(result.output).toBe("Created New survey (1NeW)");
  });

  it("prints the new form id in quiet mode", async () => {
    const result = await run({ format: "text", quiet: true });
    expect(result.output).toBe("1NeW");
  });

  it("leaves no empty form behind when the document does not parse", async () => {
    const createForm = vi.fn(async (title: string) => ({ id: "1NeW", title }));
    const result = await run({
      source: "form.yaml",
      readInput: async () => "title: [unclosed\n",
      createForm,
    });
    expect(result.error instanceof AppError ? result.error.code : "").toBe("INVALID_ARGS");
    expect(createForm).not.toHaveBeenCalled();
  });
  /**
   * Decision 0055 §1-§2. The title is the Drive name, so the same `create` run
   * twice is the collision - and §2 puts the check ahead of `forms.create`,
   * because a refusal afterwards leaves a form the caller has to go and delete,
   * items and all.
   */
  describe("a title that would not address the new form", () => {
    const siblings = (nodes: DriveNode[]) => {
      const { client } = createWritableTreeDrive(nodes);
      return (parentId: string, name: string) => childrenNamed(client, parentId, name);
    };

    it("refuses a title --parent already holds, and creates nothing", async () => {
      const result = await run({
        parent: "Surveys",
        source: "@form.yaml",
        findSiblings: siblings([{ id: "E1", name: "New survey", parents: ["1FoLdEr"] }]),
      });
      expect(codeOf(result.error)).toBe("INVALID_ARGS");
      expect(String(result.error)).toContain("E1");
      expect(result.created).toEqual([]);
      expect(result.batches).toEqual([]);
      expect(result.moves).toEqual([]);
    });

    it("refuses a title the My Drive root already holds", async () => {
      const result = await run({
        findSiblings: siblings([{ id: "E1", name: "New survey", parents: [ROOT_ID] }]),
      });
      expect(codeOf(result.error)).toBe("INVALID_ARGS");
      expect(result.created).toEqual([]);
    });

    it.each(UNPATHABLE_NAMES)("refuses %j without asking Drive anything", async (title) => {
      const findSiblings = vi.fn(async () => []);
      const result = await run({ title, findSiblings });
      expect(codeOf(result.error)).toBe("INVALID_ARGS");
      expect(findSiblings).not.toHaveBeenCalled();
      expect(result.created).toEqual([]);
    });
  });
});
