import { describe, expect, it, vi } from "vitest";
import { handleDocsReplace } from "./replace.ts";

function collect() {
  const lines: string[] = [];
  return {
    write: (m: string) => lines.push(m),
    get output() {
      return lines.join("\n");
    },
  };
}

const baseDeps = () => ({
  resolvePath: vi.fn(async () => "D1"),
  replaceAllText: vi.fn(
    async (_id: string, _find: string, _replace: string, _matchCase: boolean) => 3,
  ),
  replaceMarkdown: vi.fn(
    async (_id: string, _find: string, _replace: string, _matchCase: boolean) => ({
      replaced: 3,
      unsupported: [],
    }),
  ),
  readInput: vi.fn(async (arg: string) => arg),
  warn: vi.fn(),
  file: "Notes",
  find: "old",
  replace: "new",
  format: "text" as const,
  quiet: false,
  write: () => {},
});

describe("handleDocsReplace", () => {
  it("replaces with Markdown structure by default, case-insensitively", async () => {
    const d = baseDeps();
    const out = collect();
    await handleDocsReplace({ ...d, write: out.write });
    expect(d.replaceMarkdown).toHaveBeenCalledWith("D1", "old", "new", false);
    expect(d.replaceAllText).not.toHaveBeenCalled();
    expect(out.output).toBe("Replaced 3 occurrences");
  });

  it("--as text goes back to the one replaceAllText call", async () => {
    const d = baseDeps();
    await handleDocsReplace({ ...d, as: "text" });
    expect(d.replaceAllText).toHaveBeenCalledWith("D1", "old", "new", false);
    expect(d.replaceMarkdown).not.toHaveBeenCalled();
  });

  it("honors --match-case", async () => {
    const d = baseDeps();
    await handleDocsReplace({ ...d, matchCase: true });
    expect(d.replaceMarkdown).toHaveBeenCalledWith("D1", "old", "new", true);
  });

  it("uses the singular form for a single occurrence", async () => {
    const out = collect();
    await handleDocsReplace({
      ...baseDeps(),
      replaceMarkdown: vi.fn(async () => ({ replaced: 1, unsupported: [] })),
      write: out.write,
    });
    expect(out.output).toBe("Replaced 1 occurrence");
  });

  it("reads the replacement through the @file/stdin reader", async () => {
    const d = baseDeps();
    const readInput = vi.fn(async () => "# from file");
    await handleDocsReplace({ ...d, replace: "@draft.md", readInput });
    expect(readInput).toHaveBeenCalledWith("@draft.md");
    expect(d.replaceMarkdown).toHaveBeenCalledWith("D1", "old", "# from file", false);
  });

  it("rejects an empty --find", async () => {
    await expect(handleDocsReplace({ ...baseDeps(), find: "" })).rejects.toMatchObject({
      code: "INVALID_ARGS",
    });
  });

  it("prints the document id in quiet mode and the count in JSON", async () => {
    const q = collect();
    await handleDocsReplace({ ...baseDeps(), quiet: true, write: q.write });
    expect(q.output).toBe("D1");

    const j = collect();
    await handleDocsReplace({ ...baseDeps(), format: "json", write: j.write });
    expect(JSON.parse(j.output)).toEqual({
      success: true,
      data: { id: "D1", replaced: 3, message: "Replaced 3 occurrences" },
    });
  });
});
