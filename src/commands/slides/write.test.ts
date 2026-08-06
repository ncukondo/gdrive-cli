import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../types/index.ts";
import {
  slideDocumentToYaml,
  toSlideDocument,
  type PageElementRaw,
  type PresentationRaw,
  type SlideDocument,
} from "../../lib/slide-document.ts";
import type { SlidesRequest } from "../../lib/slides-api.ts";
import { handleSlidesWrite, type SlidesWriteDeps } from "./write.ts";

function collect() {
  const lines: string[] = [];
  return {
    write: (m: string) => lines.push(m),
    get output() {
      return lines.join("\n");
    },
  };
}

function runsOf(...paragraphs: string[]) {
  return {
    textElements: paragraphs.map((content) => ({ textRun: { content: `${content}\n` } })),
  };
}

function placeholder(objectId: string, type: string, text: string): PageElementRaw {
  return { objectId, shape: { placeholder: { type, index: 0 }, text: runsOf(text) } };
}

const deck: PresentationRaw = {
  presentationId: "1PrEs",
  title: "Q3 review",
  revisionId: "abc123",
  layouts: [
    {
      objectId: "L_TB",
      layoutProperties: { name: "TITLE_AND_BODY" },
      pageElements: [placeholder("l_t", "TITLE", ""), placeholder("l_b", "BODY", "")],
    },
  ],
  slides: [
    {
      objectId: "s1",
      slideProperties: { layoutObjectId: "L_TB" },
      pageElements: [
        placeholder("t1", "TITLE", "The quarter in one slide"),
        {
          objectId: "b1",
          shape: {
            placeholder: { type: "BODY", index: 0 },
            // Two runs: one word of the body is bold, so a rewrite costs it.
            text: {
              textElements: [
                { textRun: { content: "Revenue " } },
                { textRun: { content: "up 12%\n" } },
              ],
            },
          },
        },
      ],
    },
    {
      objectId: "s2",
      slideProperties: { layoutObjectId: "L_TB" },
      pageElements: [placeholder("t2", "TITLE", "What we do next")],
    },
  ],
};

const document = toSlideDocument(deck);

interface Run {
  output: string;
  warnings: string[];
  batches: { presentationId: string; requests: SlidesRequest[]; revisionId?: string }[];
  error?: unknown;
}

/** Runs the handler over a document, capturing what it wrote and sent. */
async function run(
  doc: SlideDocument | string,
  options: Partial<SlidesWriteDeps> = {},
  current: PresentationRaw = deck,
): Promise<Run> {
  const out = collect();
  const warnings: string[] = [];
  const batches: Run["batches"] = [];
  const text = typeof doc === "string" ? doc : slideDocumentToYaml(doc);

  const deps: SlidesWriteDeps = {
    resolvePath: async () => "1PrEs",
    getPresentation: async () => current,
    batchUpdate: async (presentationId, requests, revisionId) => {
      batches.push({
        presentationId,
        requests,
        ...(revisionId !== undefined ? { revisionId } : {}),
      });
    },
    readInput: async () => text,
    file: "1PrEs",
    format: "json",
    quiet: false,
    write: out.write,
    warn: (m) => warnings.push(m),
    ...options,
  };

  try {
    await handleSlidesWrite(deps);
  } catch (error) {
    return { output: out.output, warnings, batches, error };
  }
  return { output: out.output, warnings, batches };
}

const codeOf = (error: unknown): string =>
  error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;

/** The document with the first slide's title changed. */
function renamed(): SlideDocument {
  const [first, ...rest] = document.slides;
  return { ...document, slides: [{ ...first, title: "The quarter in a sentence" }, ...rest] };
}

describe("handleSlidesWrite", () => {
  it("fetches the deck the argument resolved to, not the argument", async () => {
    const resolvePath = vi.fn(async () => "1PrEs");
    const getPresentation = vi.fn(async () => deck);
    await run(document, { resolvePath, getPresentation, file: "Decks/Q3" });
    expect(resolvePath).toHaveBeenCalledWith("Decks/Q3");
    expect(getPresentation).toHaveBeenCalledWith("1PrEs");
  });

  it("writes nothing and says so for the document the deck itself produced", async () => {
    const result = await run(document);
    expect(result.batches).toEqual([]);
    const envelope = JSON.parse(result.output);
    expect(envelope.data.plan).toEqual([]);
    expect(envelope.data.applied).toBe(false);
  });

  it("says so in text mode too, without a table nobody needs", async () => {
    const result = await run(document, { format: "text" });
    expect(result.output).toBe("No changes to 1PrEs");
  });

  it("sends the whole plan as one batchUpdate", async () => {
    const result = await run(renamed());
    expect(result.batches).toHaveLength(1);
    expect(result.batches[0]?.presentationId).toBe("1PrEs");
    expect(result.batches[0]?.requests).toEqual([
      { deleteText: { objectId: "t1", textRange: { type: "ALL" } } },
      { insertText: { objectId: "t1", insertionIndex: 0, text: "The quarter in a sentence" } },
    ]);
  });

  it("sends the document's revision as writeControl (0028 §5)", async () => {
    expect((await run(renamed())).batches[0]?.revisionId).toBe("abc123");
  });

  it("writes unconditionally when the document carries no revision", async () => {
    const { revision_id: _revision, ...withoutRevision } = renamed();
    const result = await run(withoutRevision);
    expect(result.batches).toHaveLength(1);
    expect(result.batches[0]?.revisionId).toBeUndefined();
  });

  it("surfaces a stale revision as the API's own refusal", async () => {
    const batchUpdate = async () => {
      throw new AppError("API_ERROR", "The presentation changed since it was read at revision …");
    };
    const result = await run(renamed(), { batchUpdate });
    expect(codeOf(result.error)).toBe("API_ERROR");
  });

  it("fails INVALID_ARGS on YAML that does not parse", async () => {
    expect(codeOf((await run("title: [unclosed\n")).error)).toBe("INVALID_ARGS");
  });

  it("fails INVALID_ARGS naming the offending path on a schema violation", async () => {
    const result = await run("title: T\nslides:\n  - layout: 3\n");
    expect(codeOf(result.error)).toBe("INVALID_ARGS");
    expect(result.error instanceof Error ? result.error.message : "").toContain("slides.0.layout");
  });

  it("does not touch the API for a document that could not be parsed", async () => {
    const getPresentation = vi.fn(async () => deck);
    const result = await run("- not a mapping\n", { getPresentation });
    expect(codeOf(result.error)).toBe("INVALID_ARGS");
    expect(getPresentation).not.toHaveBeenCalled();
  });

  it("reads --file as a path, @path as a path, and no --file as stdin", async () => {
    const seen: string[] = [];
    const readInput = async (arg: string) => {
      seen.push(arg);
      return slideDocumentToYaml(document);
    };
    await run(document, { readInput, source: "deck.yaml" });
    await run(document, { readInput, source: "@deck.yaml" });
    await run(document, { readInput, source: "-" });
    await run(document, { readInput });
    expect(seen).toEqual(["@deck.yaml", "@deck.yaml", "-", "-"]);
  });
});

describe("the plan handleSlidesWrite reports (0028 §4, 0030 §2)", () => {
  it("lists each change with the slide it names, in data.plan", async () => {
    const result = await run(renamed());
    expect(JSON.parse(result.output).data).toMatchObject({
      id: "1PrEs",
      applied: true,
      plan: [
        {
          action: "update",
          id: "s1",
          title: "The quarter in a sentence",
          index: 0,
          fields: ["title"],
        },
      ],
    });
  });

  it("summarizes the same plan in text mode, one row per change", async () => {
    const result = await run(renamed(), { format: "text" });
    const [header, row, summary] = result.output.split("\n");
    expect(header?.split("\t")).toEqual(["action", "position", "id", "title", "fields"]);
    expect(row?.split("\t")).toEqual(["update", "0", "s1", "The quarter in a sentence", "title"]);
    expect(summary).toBe("Applied 1 change to 1PrEs");
  });

  it("prints the number of changes in quiet mode", async () => {
    expect((await run(renamed(), { format: "text", quiet: true })).output).toBe("1");
  });

  it("issues no batchUpdate at all for --dry-run, and reports the same plan", async () => {
    const batchUpdate = vi.fn(async () => {});
    const dry = await run(renamed(), { batchUpdate, dryRun: true });
    const wet = await run(renamed());
    expect(batchUpdate).toHaveBeenCalledTimes(0);
    expect(JSON.parse(dry.output).data.plan).toEqual(JSON.parse(wet.output).data.plan);
    expect(JSON.parse(dry.output).data).toMatchObject({ applied: false, dry_run: true });
  });

  /**
   * 0030 §2's whole claim: the cost is stated before it is paid. A dry run has
   * to carry the warning, or `--dry-run` is not the check it is sold as.
   */
  it("warns before the write that rewriting a styled placeholder drops its formatting", async () => {
    const [first, ...rest] = document.slides;
    const edited = {
      ...document,
      slides: [{ ...first, body: "Revenue up 15%" }, ...rest],
    };
    const dry = await run(edited, { dryRun: true });
    expect(JSON.parse(dry.output).data.plan[0]).toMatchObject({ formatting_loss: ["body"] });
    expect(dry.batches).toEqual([]);

    const text = await run(edited, { format: "text", dryRun: true });
    expect(text.output).toContain("body");
    expect(text.output.split("\n").at(-2)).toContain("formatting");
    expect(text.output.split("\n").at(-1)).toBe(
      "Planned 1 change to 1PrEs; --dry-run wrote nothing",
    );
  });

  it("says nothing about formatting for a placeholder that was one run", async () => {
    const result = await run(renamed(), { format: "text" });
    expect(result.output).not.toContain("formatting");
  });

  /**
   * A deck's title is its Drive name, and `gdrive rename` changes that in one
   * call — so a report that only said no request could carry it would send a
   * caller away from a command they already have.
   */
  it("names the command that can rename the deck, which this one cannot", async () => {
    const result = await run({ ...document, title: "Q4 review" }, { format: "text" });
    expect(result.batches).toEqual([]);
    expect(result.warnings[0]).toContain("Q4 review");
    expect(result.warnings[0]).toContain("gdrive rename");
  });

  it("reports a field it could not write through the unsupported channel", async () => {
    const withSubtitle = {
      ...document,
      slides: document.slides.map((slide, index) =>
        index === 1 ? { ...slide, subtitle: "October 2026" } : slide,
      ),
    };
    const json = await run(withSubtitle);
    expect(JSON.parse(json.output).data.unsupported).toEqual([
      { index: 1, title: "What we do next", kind: "subtitle" },
    ]);
    const text = await run(withSubtitle, { format: "text" });
    expect(text.warnings[0]).toContain("What we do next");
    expect(text.warnings[0]).toContain("layout");
  });
});

describe("deleting a slide (decision 0028 §3, adopted by 0030 §1)", () => {
  const shorter = (): SlideDocument => ({ ...document, slides: document.slides.slice(0, 1) });

  it("refuses without --prune, naming the slide and the flag, and writes nothing", async () => {
    const result = await run(shorter());
    expect(codeOf(result.error)).toBe("PRUNE_REQUIRED");
    const message = result.error instanceof Error ? result.error.message : "";
    expect(message).toContain("What we do next");
    expect(message).toContain("s2");
    expect(message).toContain("--prune");
    expect(result.batches).toEqual([]);
  });

  it("refuses a dry run too, so the flag is learned before anything is at risk", async () => {
    expect(codeOf((await run(shorter(), { dryRun: true })).error)).toBe("PRUNE_REQUIRED");
  });

  it("deletes with --prune, and the plan names the same slide the refusal did", async () => {
    const result = await run(shorter(), { prune: true });
    expect(JSON.parse(result.output).data.plan).toEqual([
      { action: "delete", id: "s2", title: "What we do next", index: 1 },
    ]);
    expect(result.batches[0]?.requests).toEqual([{ deleteObject: { objectId: "s2" } }]);
  });
});
