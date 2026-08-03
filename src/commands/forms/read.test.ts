import { describe, expect, it, vi } from "vitest";
import { parseFormDocument, type FormRaw } from "../../lib/form-document.ts";
import { handleFormsRead } from "./read.ts";

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
  info: { title: "2026 Engagement survey", description: "Takes about five minutes." },
  revisionId: "00000007",
  linkedSheetId: "1ShEeT",
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
            options: [{ value: "Sales" }, { value: "Other", isOther: true }],
          },
        },
      },
    },
  ],
};

const withVideo: FormRaw = {
  formId: "1FoRm",
  info: { title: "Onboarding" },
  items: [
    {
      itemId: "i1",
      title: "Watch this",
      videoItem: { video: { youtubeUri: "https://youtu.be/x" } },
    },
  ],
};

describe("handleFormsRead", () => {
  it("fetches the form the argument resolved to, not the argument", async () => {
    const resolvePath = vi.fn(async () => "1FoRm");
    const getForm = vi.fn(async () => form);
    const out = collect();
    await handleFormsRead({
      resolvePath,
      getForm,
      file: "Surveys/2026",
      format: "text",
      quiet: false,
      write: out.write,
      warn: () => {},
    });
    expect(resolvePath).toHaveBeenCalledWith("Surveys/2026");
    expect(getForm).toHaveBeenCalledWith("1FoRm");
  });

  it("writes the YAML document, which parses back to the same structure", async () => {
    const out = collect();
    await handleFormsRead({
      resolvePath: async () => "1FoRm",
      getForm: async () => form,
      file: "1FoRm",
      format: "text",
      quiet: false,
      write: out.write,
      warn: () => {},
    });
    expect(out.output).toContain("title: 2026 Engagement survey");
    expect(parseFormDocument(out.output)).toEqual({
      id: "1FoRm",
      title: "2026 Engagement survey",
      description: "Takes about five minutes.",
      revision_id: "00000007",
      linked_sheet_id: "1ShEeT",
      items: [
        {
          id: "i1",
          question_id: "q1",
          type: "choice",
          choice_type: "radio",
          title: "Which team are you on?",
          required: true,
          options: ["Sales", { value: "Other", other: true }],
        },
      ],
    });
  });

  it("carries the structure itself in data.form, not a YAML string", async () => {
    const out = collect();
    await handleFormsRead({
      resolvePath: async () => "1FoRm",
      getForm: async () => form,
      file: "1FoRm",
      format: "json",
      quiet: false,
      write: out.write,
      warn: () => {},
    });
    const envelope = JSON.parse(out.output);
    expect(envelope.success).toBe(true);
    expect(envelope.data.id).toBe("1FoRm");
    expect(envelope.data.form.items[0].choice_type).toBe("radio");
    expect(envelope.data.unsupported).toBeUndefined();
  });

  it("prints the form id in quiet mode", async () => {
    const out = collect();
    await handleFormsRead({
      resolvePath: async () => "1FoRm",
      getForm: async () => form,
      file: "1FoRm",
      format: "text",
      quiet: true,
      write: out.write,
      warn: () => {},
    });
    expect(out.output).toBe("1FoRm");
  });

  it("warns once on stderr for an item it could not model", async () => {
    const out = collect();
    const warnings: string[] = [];
    await handleFormsRead({
      resolvePath: async () => "1FoRm",
      getForm: async () => withVideo,
      file: "1FoRm",
      format: "text",
      quiet: false,
      write: out.write,
      warn: (m) => warnings.push(m),
    });
    expect(warnings).toEqual(["Kept as raw: videoItem (item i1)"]);
    expect(out.output).toContain("type: unsupported");
  });

  it("reports the same items in JSON instead of on stderr", async () => {
    const out = collect();
    const warnings: string[] = [];
    await handleFormsRead({
      resolvePath: async () => "1FoRm",
      getForm: async () => withVideo,
      file: "1FoRm",
      format: "json",
      quiet: false,
      write: out.write,
      warn: (m) => warnings.push(m),
    });
    expect(warnings).toEqual([]);
    expect(JSON.parse(out.output).data.unsupported).toEqual([{ id: "i1", kind: "videoItem" }]);
  });

  it("keeps the unmodelled item's API resource in the document", async () => {
    const out = collect();
    await handleFormsRead({
      resolvePath: async () => "1FoRm",
      getForm: async () => withVideo,
      file: "1FoRm",
      format: "json",
      quiet: false,
      write: out.write,
      warn: () => {},
    });
    expect(JSON.parse(out.output).data.form.items[0].raw).toEqual({
      itemId: "i1",
      title: "Watch this",
      videoItem: { video: { youtubeUri: "https://youtu.be/x" } },
    });
  });
});
