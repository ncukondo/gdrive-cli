import { describe, expect, it } from "vitest";
import { AppError } from "../types/index.ts";
import {
  parseSlideDocument,
  slideDocumentToYaml,
  toSlideDocument,
  type PageElementRaw,
  type PresentationRaw,
} from "./slide-document.ts";

/**
 * A shape's text as the API returns it: one run per paragraph, each ending in
 * the newline the API always appends.
 */
function runs(...paragraphs: string[]) {
  return {
    textElements: paragraphs.map((content) => ({ textRun: { content: `${content}\n` } })),
  };
}

/** Every element the API returns carries geometry; none of it may be projected. */
const geometry = {
  size: { width: { magnitude: 3000000, unit: "EMU" }, height: { magnitude: 1000000, unit: "EMU" } },
  transform: { scaleX: 1, scaleY: 1, translateX: 311700, translateY: 445025, unit: "EMU" },
};

function placeholder(objectId: string, type: string, ...paragraphs: string[]): PageElementRaw {
  return {
    objectId,
    ...geometry,
    shape: { shapeType: "TEXT_BOX", placeholder: { type, index: 0 }, text: runs(...paragraphs) },
  };
}

function notesPage(speakerNotesObjectId: string, ...paragraphs: string[]) {
  return {
    objectId: "n1",
    notesProperties: { speakerNotesObjectId },
    pageElements: [
      { objectId: "n1_img", ...geometry, image: { contentUrl: "https://…" } },
      {
        objectId: speakerNotesObjectId,
        ...geometry,
        shape: { placeholder: { type: "BODY" }, text: runs(...paragraphs) },
      },
    ],
  };
}

const layouts = [
  { objectId: "L_TB", layoutProperties: { name: "TITLE_AND_BODY", displayName: "Title and body" } },
  { objectId: "L_SH", layoutProperties: { name: "SECTION_HEADER" } },
  { objectId: "L_BLANK", layoutProperties: { name: "BLANK" } },
];

const deck: PresentationRaw = {
  presentationId: "1PrEs",
  title: "Q3 review",
  revisionId: "abc123",
  layouts,
  slides: [
    {
      objectId: "g2a1b3c",
      slideProperties: {
        layoutObjectId: "L_TB",
        notesPage: notesPage("g2a1b3c_notes", "Take questions here"),
      },
      pageElements: [
        placeholder("t1", "TITLE", "The quarter in one slide"),
        placeholder("b1", "BODY", "Revenue up 12%", "Churn flat"),
      ],
    },
    {
      objectId: "g5d6e7f",
      slideProperties: { layoutObjectId: "L_SH", isSkipped: false },
      pageElements: [placeholder("t2", "TITLE", "What we do next")],
    },
    {
      objectId: "g7h8i9j",
      slideProperties: { layoutObjectId: "L_BLANK", isSkipped: true },
      pageElements: [],
    },
  ],
};

describe("toSlideDocument", () => {
  it("projects a deck as its layouts, placeholders and speaker notes", () => {
    expect(toSlideDocument(deck)).toEqual({
      id: "1PrEs",
      title: "Q3 review",
      revision_id: "abc123",
      slides: [
        {
          id: "g2a1b3c",
          layout: "TITLE_AND_BODY",
          title: "The quarter in one slide",
          body: "Revenue up 12%\nChurn flat",
          notes: "Take questions here",
        },
        { id: "g5d6e7f", layout: "SECTION_HEADER", title: "What we do next" },
        { id: "g7h8i9j", layout: "BLANK", skipped: true },
      ],
    });
  });

  it("names the SUBTITLE and CENTERED_TITLE placeholders of a title slide", () => {
    const document = toSlideDocument({
      title: "Deck",
      layouts: [{ objectId: "L_T", layoutProperties: { name: "TITLE" } }],
      slides: [
        {
          objectId: "s1",
          slideProperties: { layoutObjectId: "L_T" },
          pageElements: [
            placeholder("t", "CENTERED_TITLE", "Q3 review"),
            placeholder("s", "SUBTITLE", "October 2026"),
          ],
        },
      ],
    });
    expect(document.slides[0]).toEqual({
      id: "s1",
      layout: "TITLE",
      title: "Q3 review",
      subtitle: "October 2026",
    });
  });

  it("reports a custom layout by its object id, having no name to report", () => {
    const document = toSlideDocument({
      title: "Deck",
      layouts: [{ objectId: "L_CUSTOM", layoutProperties: { displayName: "Our house style" } }],
      slides: [{ objectId: "s1", slideProperties: { layoutObjectId: "L_CUSTOM" } }],
    });
    expect(document.slides[0]).toEqual({ id: "s1", layout: "L_CUSTOM" });
  });

  it("omits a placeholder with no text rather than emitting it empty", () => {
    const document = toSlideDocument({
      title: "Deck",
      layouts,
      slides: [
        {
          objectId: "s1",
          slideProperties: { layoutObjectId: "L_TB" },
          pageElements: [placeholder("t1", "TITLE", "Only a title"), placeholder("b1", "BODY", "")],
        },
      ],
    });
    expect(document.slides[0]).toEqual({
      id: "s1",
      layout: "TITLE_AND_BODY",
      title: "Only a title",
    });
  });
});

describe("toSlideDocument, on what is not a placeholder (0029 §3)", () => {
  const handmade: PresentationRaw = {
    presentationId: "1PrEs",
    title: "Built by hand",
    layouts,
    slides: [
      {
        objectId: "s1",
        slideProperties: { layoutObjectId: "L_BLANK" },
        pageElements: [
          {
            objectId: "g1k2l3m",
            ...geometry,
            shape: { shapeType: "TEXT_BOX", text: runs("A heading someone placed by hand") },
          },
          { objectId: "g4n5o6p", ...geometry, image: { contentUrl: "https://…" } },
          { objectId: "g7p8q9r", ...geometry, table: { rows: 2, columns: 2 } },
          { objectId: "g1s2t3u", ...geometry, sheetsChart: { spreadsheetId: "1ShEeT" } },
        ],
      },
    ],
  };

  it("lists a hand-placed text box with its text, and an image with none", () => {
    expect(toSlideDocument(handmade).slides[0]).toEqual({
      id: "s1",
      layout: "BLANK",
      elements: [
        { id: "g1k2l3m", kind: "shape", text: "A heading someone placed by hand" },
        { id: "g4n5o6p", kind: "image" },
        { id: "g7p8q9r", kind: "table" },
        { id: "g1s2t3u", kind: "chart" },
      ],
    });
  });

  it("carries no transform and no size, whatever the element", () => {
    const elements = toSlideDocument(handmade).slides[0]?.elements ?? [];
    for (const element of elements) {
      expect(Object.keys(element).every((key) => ["id", "kind", "text"].includes(key))).toBe(true);
    }
  });

  it("names an element kind googleapis grows later rather than dropping it", () => {
    // Not a literal in place: a kind this CLI has never heard of is exactly the
    // shape `PageElementRaw` does not declare.
    const hologram = { objectId: "e1", ...geometry, hologram: { depth: 3 } };
    const document = toSlideDocument({
      title: "Deck",
      layouts,
      slides: [
        {
          objectId: "s1",
          slideProperties: { layoutObjectId: "L_BLANK" },
          pageElements: [hologram],
        },
      ],
    });
    expect(document.slides[0]?.elements).toEqual([{ id: "e1", kind: "unknown" }]);
  });

  it("lists a second placeholder of a type already taken, so its text is not lost", () => {
    const document = toSlideDocument({
      title: "Deck",
      layouts: [{ objectId: "L_2C", layoutProperties: { name: "TITLE_AND_TWO_COLUMNS" } }],
      slides: [
        {
          objectId: "s1",
          slideProperties: { layoutObjectId: "L_2C" },
          pageElements: [
            placeholder("b1", "BODY", "Left column"),
            placeholder("b2", "BODY", "Right column"),
          ],
        },
      ],
    });
    expect(document.slides[0]).toEqual({
      id: "s1",
      layout: "TITLE_AND_TWO_COLUMNS",
      body: "Left column",
      elements: [{ id: "b2", kind: "shape", text: "Right column" }],
    });
  });

  it("leaves an empty placeholder the document has no field for out of elements", () => {
    const document = toSlideDocument({
      title: "Deck",
      layouts,
      slides: [
        {
          objectId: "s1",
          slideProperties: { layoutObjectId: "L_BLANK" },
          pageElements: [placeholder("n1", "SLIDE_NUMBER", "")],
        },
      ],
    });
    expect(document.slides[0]).toEqual({ id: "s1", layout: "BLANK" });
  });
});

describe("slideDocumentToYaml / parseSlideDocument", () => {
  it("round-trips a projected deck through YAML unchanged", () => {
    const document = toSlideDocument(deck);
    expect(parseSlideDocument(slideDocumentToYaml(document))).toEqual(document);
  });

  it("keeps a multi-line body readable rather than folding it", () => {
    const yaml = slideDocumentToYaml(toSlideDocument(deck));
    expect(yaml).toContain("Revenue up 12%\n");
    expect(yaml).toContain("Churn flat");
  });

  it("rejects YAML that is not a deck document as INVALID_ARGS", () => {
    for (const input of ["slides: [{layout: 3}]\ntitle: Deck", "title: [", "- a\n- b"]) {
      expect(() => parseSlideDocument(input)).toThrowError(AppError);
    }
  });
});
