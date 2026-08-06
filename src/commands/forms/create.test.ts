import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../types/index.ts";
import { formDocumentToYaml, toFormDocument, type FormRaw } from "../../lib/form-document.ts";
import type { FormsRequest } from "../../lib/forms-api.ts";
import { handleFormsCreate, type FormsCreateDeps } from "./create.ts";

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
          choiceQuestion: { type: "RADIO", options: [{ value: "Sales" }] },
        },
      },
    },
    { itemId: "i2", title: "Watch this", videoItem: { video: { youtubeUri: "https://y" } } },
  ],
};

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
   */
  it("creates every item afresh, carrying none of the document's ids", async () => {
    const result = await run({ source: "form.yaml" });
    const requests = result.batches[0]?.requests ?? [];
    const creates = requests.filter((request) => "createItem" in request);
    expect(creates).toHaveLength(1);
    for (const request of creates) {
      if (!("createItem" in request)) continue;
      expect(request.createItem.item.itemId).toBeUndefined();
      expect(request.createItem.item.questionItem?.question.questionId).toBeUndefined();
    }
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

  it("reports the items it could not carry over", async () => {
    const json = await run({ source: "form.yaml" });
    expect(JSON.parse(json.output).data.unsupported).toEqual([{ index: 1, title: "Watch this" }]);
    const text = await run({ source: "form.yaml", format: "text" });
    expect(text.warnings).toEqual(["Not written: Watch this (document item 1)"]);
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
});
