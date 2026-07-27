import { describe, expect, it, vi } from "vitest";
import { handleDocsRead } from "./read.ts";
import { parseDocsFormat } from "./format.ts";
import type { DocumentRaw } from "../../lib/docs-api.ts";

function collect() {
  const lines: string[] = [];
  return {
    write: (m: string) => lines.push(m),
    get output() {
      return lines.join("\n");
    },
  };
}

const document: DocumentRaw = {
  documentId: "D1",
  title: "Meeting notes",
  body: {
    content: [
      {
        paragraph: {
          elements: [{ textRun: { content: "Meeting notes\n" } }],
          paragraphStyle: { namedStyleType: "HEADING_1" },
        },
      },
      { paragraph: { elements: [{ textRun: { content: "hello\n" } }] } },
    ],
  },
};

describe("parseDocsFormat", () => {
  it("defaults to markdown and accepts text", () => {
    expect(parseDocsFormat(undefined)).toBe("markdown");
    expect(parseDocsFormat("text")).toBe("text");
    expect(parseDocsFormat("markdown")).toBe("markdown");
  });

  it("rejects unknown formats", () => {
    expect(() => parseDocsFormat("html")).toThrow(/Invalid --as/);
  });
});

describe("handleDocsRead", () => {
  it("resolves the file and writes markdown by default", async () => {
    const resolvePath = vi.fn(async () => "D1");
    const out = collect();
    await handleDocsRead({
      resolvePath,
      getDocument: async () => document,
      file: "Notes/Meeting",
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(resolvePath).toHaveBeenCalledWith("Notes/Meeting");
    expect(out.output).toBe("# Meeting notes\nhello");
  });

  it("renders plain text with --as text", async () => {
    const out = collect();
    await handleDocsRead({
      resolvePath: async () => "D1",
      getDocument: async () => document,
      file: "D1",
      as: "text",
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(out.output).toBe("Meeting notes\nhello");
  });

  it("emits id, title, format, and content in JSON", async () => {
    const out = collect();
    await handleDocsRead({
      resolvePath: async () => "D1",
      getDocument: async () => document,
      file: "D1",
      format: "json",
      quiet: false,
      write: out.write,
    });
    expect(JSON.parse(out.output)).toEqual({
      success: true,
      data: {
        id: "D1",
        title: "Meeting notes",
        format: "markdown",
        content: "# Meeting notes\nhello",
      },
    });
  });

  it("prints the content in quiet mode too", async () => {
    const out = collect();
    await handleDocsRead({
      resolvePath: async () => "D1",
      getDocument: async () => document,
      file: "D1",
      format: "text",
      quiet: true,
      write: out.write,
    });
    expect(out.output).toBe("# Meeting notes\nhello");
  });
});
