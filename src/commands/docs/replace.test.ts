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
  file: "Notes",
  find: "old",
  replace: "new",
  format: "text" as const,
  quiet: false,
  write: () => {},
});

describe("handleDocsReplace", () => {
  it("replaces case-insensitively by default and reports the count", async () => {
    const d = baseDeps();
    const out = collect();
    await handleDocsReplace({ ...d, write: out.write });
    expect(d.replaceAllText).toHaveBeenCalledWith("D1", "old", "new", false);
    expect(out.output).toBe("Replaced 3 occurrences");
  });

  it("honors --match-case", async () => {
    const d = baseDeps();
    await handleDocsReplace({ ...d, matchCase: true });
    expect(d.replaceAllText).toHaveBeenCalledWith("D1", "old", "new", true);
  });

  it("uses the singular form for a single occurrence", async () => {
    const out = collect();
    await handleDocsReplace({
      ...baseDeps(),
      replaceAllText: vi.fn(async () => 1),
      write: out.write,
    });
    expect(out.output).toBe("Replaced 1 occurrence");
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
