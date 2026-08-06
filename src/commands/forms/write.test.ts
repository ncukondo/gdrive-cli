import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../types/index.ts";
import {
  formDocumentToYaml,
  toFormDocument,
  type FormDocument,
  type FormRaw,
} from "../../lib/form-document.ts";
import type { FormsRequest } from "../../lib/forms-api.ts";
import { handleFormsWrite, type FormsWriteDeps } from "./write.ts";

function collect() {
  const lines: string[] = [];
  return {
    write: (m: string) => lines.push(m),
    get output() {
      return lines.join("\n");
    },
  };
}

const form: FormRaw = {
  formId: "1FoRm",
  info: { title: "Survey" },
  revisionId: "00000007",
  responderUri: "https://docs.google.com/forms/d/e/1FaIpQ/viewform",
  linkedSheetId: "1ShEeT",
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
    {
      itemId: "i2",
      title: "How satisfied are you?",
      questionItem: {
        question: { questionId: "q2", scaleQuestion: { low: 1, high: 5 } },
      },
    },
  ],
};

const { document } = toFormDocument(form);

interface Run {
  output: string;
  warnings: string[];
  batches: { formId: string; requests: FormsRequest[]; revisionId?: string }[];
  error?: unknown;
}

/** Runs the handler over a document, capturing what it wrote and sent. */
async function run(
  doc: FormDocument | string,
  options: Partial<FormsWriteDeps> = {},
  current: FormRaw = form,
): Promise<Run> {
  const out = collect();
  const warnings: string[] = [];
  const batches: Run["batches"] = [];
  const text = typeof doc === "string" ? doc : formDocumentToYaml(doc);

  const deps: FormsWriteDeps = {
    resolvePath: async () => "1FoRm",
    getForm: async () => current,
    batchUpdate: async (formId, requests, revisionId) => {
      batches.push({ formId, requests, ...(revisionId !== undefined ? { revisionId } : {}) });
    },
    readInput: async () => text,
    file: "1FoRm",
    format: "json",
    quiet: false,
    write: out.write,
    warn: (m) => warnings.push(m),
    ...options,
  };

  try {
    await handleFormsWrite(deps);
  } catch (error) {
    return { output: out.output, warnings, batches, error };
  }
  return { output: out.output, warnings, batches };
}

const codeOf = (error: unknown): string =>
  error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;

/** The document with one question renamed. */
function renamed(): FormDocument {
  const [first, ...rest] = document.items;
  if (first?.type !== "choice") throw new Error("fixture");
  return { ...document, items: [{ ...first, title: "Which team do you work in?" }, ...rest] };
}

describe("handleFormsWrite", () => {
  it("fetches the form the argument resolved to, not the argument", async () => {
    const resolvePath = vi.fn(async () => "1FoRm");
    const getForm = vi.fn(async () => form);
    await run(document, { resolvePath, getForm, file: "Surveys/2026" });
    expect(resolvePath).toHaveBeenCalledWith("Surveys/2026");
    expect(getForm).toHaveBeenCalledWith("1FoRm");
  });

  it("writes nothing and says so for the document the form itself produced", async () => {
    const result = await run(document);
    expect(result.batches).toEqual([]);
    const envelope = JSON.parse(result.output);
    expect(envelope.data.plan).toEqual([]);
    expect(envelope.data.applied).toBe(false);
  });

  it("says so in text mode too, without a table nobody needs", async () => {
    const result = await run(document, { format: "text" });
    expect(result.output).toBe("No changes to 1FoRm");
  });

  /** Decision 0028 §5. */
  it("sends the document's revision as writeControl", async () => {
    const result = await run(renamed());
    expect(result.batches[0]?.revisionId).toBe("00000007");
  });

  it("writes unconditionally when the document carries no revision", async () => {
    const { revision_id: _, ...withoutRevision } = renamed();
    const result = await run(withoutRevision);
    expect(result.batches).toHaveLength(1);
    expect(result.batches[0]?.revisionId).toBeUndefined();
  });

  /** Decision 0028 §6: `read` emitted these, so `write` must not reject them. */
  it("ignores the read-only fields rather than rejecting them", async () => {
    const result = await run(renamed());
    expect(result.error).toBeUndefined();
    expect(document.responder_uri).toBeDefined();
    expect(document.linked_sheet_id).toBeDefined();
    expect(document.id).toBe("1FoRm");
  });

  it("fails INVALID_ARGS on YAML that does not parse", async () => {
    const result = await run("title: [unclosed\n");
    expect(codeOf(result.error)).toBe("INVALID_ARGS");
  });

  it("fails INVALID_ARGS naming the offending path on a schema violation", async () => {
    const result = await run("title: T\nitems:\n  - type: scale\n    low: 1\n");
    expect(codeOf(result.error)).toBe("INVALID_ARGS");
    expect(result.error instanceof Error ? result.error.message : "").toContain("items.0.high");
  });

  it("does not touch the API for a document that could not be parsed", async () => {
    const getForm = vi.fn(async () => form);
    const result = await run("- not a mapping\n", { getForm });
    expect(codeOf(result.error)).toBe("INVALID_ARGS");
    expect(getForm).not.toHaveBeenCalled();
  });

  /**
   * The three routes a document can arrive by all end at the same parser: the
   * option names a path, and the `@path` / `-` spellings the rest of the CLI
   * uses keep working.
   */
  it("reads --file as a path, @path as a path, and no --file as stdin", async () => {
    const seen: string[] = [];
    const readInput = async (arg: string) => {
      seen.push(arg);
      return formDocumentToYaml(document);
    };
    await run(document, { readInput, source: "form.yaml" });
    await run(document, { readInput, source: "@form.yaml" });
    await run(document, { readInput, source: "-" });
    await run(document, { readInput });
    expect(seen).toEqual(["@form.yaml", "@form.yaml", "-", "-"]);
  });
});

describe("the plan handleFormsWrite reports (decision 0028 §4)", () => {
  it("lists each change with the item it names, in data.plan", async () => {
    const result = await run(renamed());
    expect(JSON.parse(result.output).data).toMatchObject({
      id: "1FoRm",
      applied: true,
      plan: [{ action: "update", id: "i1", title: "Which team do you work in?", index: 0 }],
    });
  });

  it("summarizes the same plan in text mode, one row per change", async () => {
    const result = await run(renamed(), { format: "text" });
    const [header, row, summary] = result.output.split("\n");
    expect(header?.split("\t")).toEqual(["action", "position", "id", "title"]);
    expect(row?.split("\t")).toEqual(["update", "0", "i1", "Which team do you work in?"]);
    expect(summary).toBe("Applied 1 change to 1FoRm");
  });

  it("counts one change as a change and two as changes", async () => {
    const doc = renamed();
    const result = await run(
      { ...doc, items: [...doc.items, { type: "text", title: "Your name" }] },
      { format: "text" },
    );
    expect(result.output.split("\n").at(-1)).toBe("Applied 2 changes to 1FoRm");
  });

  it("prints the number of changes in quiet mode", async () => {
    const result = await run(renamed(), { format: "text", quiet: true });
    expect(result.output).toBe("1");
  });

  it("issues no batchUpdate at all for --dry-run, and reports the same plan", async () => {
    const batchUpdate = vi.fn(async () => {});
    const dry = await run(renamed(), { batchUpdate, dryRun: true });
    const wet = await run(renamed());
    expect(batchUpdate).toHaveBeenCalledTimes(0);
    expect(JSON.parse(dry.output).data.plan).toEqual(JSON.parse(wet.output).data.plan);
    expect(JSON.parse(dry.output).data).toMatchObject({ applied: false, dry_run: true });
  });

  it("says a dry run wrote nothing in text mode", async () => {
    const result = await run(renamed(), { format: "text", dryRun: true });
    expect(result.output.split("\n").at(-1)).toBe(
      "Planned 1 change to 1FoRm; --dry-run wrote nothing",
    );
  });

  it("reports an item it could not add through the unsupported channel", async () => {
    const withOpaque: FormDocument = {
      ...document,
      items: [...document.items, { type: "unsupported", title: "A video", raw: {} }],
    };
    const json = await run(withOpaque);
    expect(JSON.parse(json.output).data.unsupported).toEqual([
      { index: 2, title: "A video", kind: "unsupported" },
    ]);
    const text = await run(withOpaque, { format: "text" });
    expect(text.warnings).toEqual([
      "Not written: A video (document item 2): not modelled, and `raw` is the API's shape rather than a request's",
    ]);
  });

  /**
   * The Forms API cannot create a file upload question, so a write that asked
   * for one has to say the item is not there rather than report a success.
   */
  it("reports a file upload question it was asked to add, and writes the rest", async () => {
    const withUpload: FormDocument = {
      ...document,
      items: [
        ...document.items,
        { type: "file_upload", title: "Attach your slides", folder_id: "1F" },
      ],
    };
    const result = await run(withUpload);
    expect(JSON.parse(result.output).data.unsupported).toEqual([
      { index: 2, title: "Attach your slides", kind: "fileUploadQuestion" },
    ]);
    expect(result.batches).toEqual([]);
  });
});

/**
 * The three cases a caller has to tell apart after asking for a deletion:
 * applied, refused, and never requested. Decision 0028 §4 puts the answer in
 * one place, so the envelope answers it without the exit code.
 */
describe("deleting an item (decision 0028 §3)", () => {
  const shorter = (): FormDocument => ({ ...document, items: document.items.slice(0, 1) });

  it("refuses without --prune, naming the item and the flag, and writes nothing", async () => {
    const result = await run(shorter());
    expect(codeOf(result.error)).toBe("PRUNE_REQUIRED");
    const message = result.error instanceof Error ? result.error.message : "";
    expect(message).toContain("How satisfied are you?");
    expect(message).toContain("i2");
    expect(message).toContain("--prune");
    expect(result.batches).toEqual([]);
  });

  it("refuses a dry run too, so the flag is learned before anything is at risk", async () => {
    const result = await run(shorter(), { dryRun: true });
    expect(codeOf(result.error)).toBe("PRUNE_REQUIRED");
  });

  it("deletes with --prune, and the plan names the same item the refusal did", async () => {
    const refused = await run(shorter());
    const applied = await run(shorter(), { prune: true });
    const message = refused.error instanceof Error ? refused.error.message : "";
    const deletions = JSON.parse(applied.output).data.plan.filter(
      (entry: { action: string }) => entry.action === "delete",
    );
    expect(deletions).toEqual([
      { action: "delete", id: "i2", title: "How satisfied are you?", index: 1 },
    ]);
    for (const deletion of deletions) expect(message).toContain(deletion.id);
    expect(applied.batches[0]?.requests).toEqual([{ deleteItem: { location: { index: 1 } } }]);
  });

  it("plans no deletion at all when the document asks for none", async () => {
    const result = await run(renamed(), { prune: true });
    const plan = JSON.parse(result.output).data.plan;
    expect(plan.some((entry: { action: string }) => entry.action === "delete")).toBe(false);
  });
});
