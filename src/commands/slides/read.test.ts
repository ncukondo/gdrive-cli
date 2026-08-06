import { describe, expect, it, vi } from "vitest";
import { parseSlideDocument, type PresentationRaw } from "../../lib/slide-document.ts";
import { handleSlidesRead } from "./read.ts";

function collect() {
  const lines: string[] = [];
  return {
    write: (m: string) => lines.push(m),
    get output() {
      return lines.join("\n");
    },
  };
}

function runs(...paragraphs: string[]) {
  return {
    textElements: paragraphs.map((content) => ({ textRun: { content: `${content}\n` } })),
  };
}

const layouts = [
  { objectId: "L_TB", layoutProperties: { name: "TITLE_AND_BODY" } },
  { objectId: "L_BLANK", layoutProperties: { name: "BLANK" } },
];

/** A deck built from a template: layouts, placeholders and speaker notes. */
const templated: PresentationRaw = {
  presentationId: "1PrEs",
  title: "Q3 review",
  revisionId: "abc123",
  layouts,
  slides: [
    {
      objectId: "g2a1b3c",
      slideProperties: {
        layoutObjectId: "L_TB",
        notesPage: {
          notesProperties: { speakerNotesObjectId: "n1" },
          pageElements: [
            {
              objectId: "n1",
              shape: { placeholder: { type: "BODY" }, text: runs("Take questions") },
            },
          ],
        },
      },
      pageElements: [
        {
          objectId: "t1",
          shape: { placeholder: { type: "TITLE" }, text: runs("The quarter in one slide") },
        },
        {
          objectId: "b1",
          shape: { placeholder: { type: "BODY" }, text: runs("Revenue up 12%", "Churn flat") },
        },
      ],
    },
  ],
};

/** The deck 0029 §3 exists for: nothing but shapes someone dragged on. */
const handmade: PresentationRaw = {
  presentationId: "1HaNd",
  title: "Built by hand",
  layouts,
  slides: [
    {
      objectId: "s1",
      slideProperties: { layoutObjectId: "L_BLANK" },
      pageElements: [
        {
          objectId: "e1",
          shape: { shapeType: "TEXT_BOX", text: runs("A heading someone placed by hand") },
        },
        { objectId: "e2", image: { contentUrl: "https://…" } },
      ],
    },
  ],
};

describe("handleSlidesRead", () => {
  it("fetches the presentation the argument resolved to, not the argument", async () => {
    const resolvePath = vi.fn(async () => "1PrEs");
    const getPresentation = vi.fn(async () => templated);
    const out = collect();
    await handleSlidesRead({
      resolvePath,
      getPresentation,
      file: "Decks/Q3",
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(resolvePath).toHaveBeenCalledWith("Decks/Q3");
    expect(getPresentation).toHaveBeenCalledWith("1PrEs");
  });

  it("writes the YAML document, which parses back to the same structure", async () => {
    const out = collect();
    await handleSlidesRead({
      resolvePath: async () => "1PrEs",
      getPresentation: async () => templated,
      file: "1PrEs",
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(out.output).toContain("title: Q3 review");
    expect(parseSlideDocument(out.output)).toEqual({
      id: "1PrEs",
      title: "Q3 review",
      revision_id: "abc123",
      slides: [
        {
          id: "g2a1b3c",
          layout: "TITLE_AND_BODY",
          title: "The quarter in one slide",
          body: "Revenue up 12%\nChurn flat",
          notes: "Take questions",
        },
      ],
    });
  });

  it("carries the structure itself in data.presentation, not a YAML string", async () => {
    const out = collect();
    await handleSlidesRead({
      resolvePath: async () => "1PrEs",
      getPresentation: async () => templated,
      file: "1PrEs",
      format: "json",
      quiet: false,
      write: out.write,
    });
    const envelope = JSON.parse(out.output);
    expect(envelope.success).toBe(true);
    expect(envelope.data.id).toBe("1PrEs");
    expect(envelope.data.presentation.slides[0].layout).toBe("TITLE_AND_BODY");
    expect(envelope.data.presentation.slides[0].notes).toBe("Take questions");
  });

  it("prints the presentation id in quiet mode", async () => {
    const out = collect();
    await handleSlidesRead({
      resolvePath: async () => "1PrEs",
      getPresentation: async () => templated,
      file: "1PrEs",
      format: "text",
      quiet: true,
      write: out.write,
    });
    expect(out.output).toBe("1PrEs");
  });

  it("reads a deck of hand-placed shapes as BLANK slides full of elements", async () => {
    const out = collect();
    await handleSlidesRead({
      resolvePath: async () => "1HaNd",
      getPresentation: async () => handmade,
      file: "1HaNd",
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(parseSlideDocument(out.output).slides).toEqual([
      {
        id: "s1",
        layout: "BLANK",
        elements: [
          { id: "e1", kind: "shape", text: "A heading someone placed by hand" },
          { id: "e2", kind: "image" },
        ],
      },
    ]);
  });
});
