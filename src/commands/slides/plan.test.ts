import { describe, expect, it } from "vitest";
import { AppError } from "../../types/index.ts";
import {
  toSlideDocument,
  type PageElementRaw,
  type PageRaw,
  type PresentationRaw,
  type SlideDocument,
} from "../../lib/slide-document.ts";
import { planSlideCreate, planSlideWrite, type SlidePlan } from "./plan.ts";

/** A shape's text as the API returns it: one run per paragraph, each terminated. */
function runs(...paragraphs: string[]) {
  return {
    textElements: paragraphs.map((content) => ({ textRun: { content: `${content}\n` } })),
  };
}

function placeholderAt(
  objectId: string,
  type: string,
  index: number,
  ...paragraphs: string[]
): PageElementRaw {
  return { objectId, shape: { placeholder: { type, index }, text: runs(...paragraphs) } };
}

function placeholder(objectId: string, type: string, ...paragraphs: string[]): PageElementRaw {
  return placeholderAt(objectId, type, 0, ...paragraphs);
}

/** A shape nobody's layout put there — the text box someone dragged on. */
function box(objectId: string, text: string): PageElementRaw {
  return { objectId, shape: { shapeType: "TEXT_BOX", text: runs(text) } };
}

function notesPage(speakerNotesObjectId: string, ...paragraphs: string[]): PageRaw {
  return {
    objectId: `${speakerNotesObjectId}_page`,
    notesProperties: { speakerNotesObjectId },
    pageElements: [
      {
        objectId: speakerNotesObjectId,
        shape: { placeholder: { type: "BODY" }, text: runs(...paragraphs) },
      },
    ],
  };
}

/** A layout's placeholders, which is all a `createSlide` needs from a layout. */
function layout(objectId: string, name: string, ...types: [string, number][]): PageRaw {
  return {
    objectId,
    layoutProperties: { name },
    pageElements: types.map(([type, index]) =>
      placeholderAt(`${objectId}_${type}`, type, index, ""),
    ),
  };
}

const layouts: PageRaw[] = [
  layout("L_TB", "TITLE_AND_BODY", ["TITLE", 0], ["BODY", 0]),
  layout("L_T", "TITLE", ["CENTERED_TITLE", 0], ["SUBTITLE", 0]),
  layout("L_2C", "TITLE_AND_TWO_COLUMNS", ["TITLE", 0], ["BODY", 0], ["BODY", 1]),
  layout("L_BLANK", "BLANK"),
];

/** A title whose second half is bold, so rewriting it costs something (0030 §2). */
const styledTitle: PageElementRaw = {
  objectId: "t2",
  shape: {
    placeholder: { type: "CENTERED_TITLE", index: 0 },
    text: {
      textElements: [
        { paragraphMarker: {} },
        { textRun: { content: "What we do " } },
        { textRun: { content: "next\n" } },
      ],
    },
  },
};

const deck: PresentationRaw = {
  presentationId: "1PrEs",
  title: "Q3 review",
  revisionId: "abc123",
  layouts,
  slides: [
    {
      objectId: "s1",
      slideProperties: {
        layoutObjectId: "L_TB",
        notesPage: notesPage("s1_notes", "Take questions here"),
      },
      pageElements: [
        placeholder("t1", "TITLE", "The quarter in one slide"),
        placeholder("b1", "BODY", "Revenue up 12%", "Churn flat"),
      ],
    },
    {
      objectId: "s2",
      slideProperties: { layoutObjectId: "L_T" },
      pageElements: [styledTitle, placeholder("sub2", "SUBTITLE", "")],
    },
    {
      objectId: "s3",
      slideProperties: { layoutObjectId: "L_BLANK" },
      pageElements: [box("x3", "A heading someone placed by hand")],
    },
  ],
};

const document = toSlideDocument(deck);

/** The document as `read` emitted it, with the named slide changed. */
function edited(index: number, change: Record<string, unknown>): SlideDocument {
  return {
    ...document,
    slides: document.slides.map((slide, at) => (at === index ? { ...slide, ...change } : slide)),
  };
}

const plan = (doc: SlideDocument, prune = false): SlidePlan => planSlideWrite(deck, doc, { prune });

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;
  }
  return "no error";
}

/** The {@link AppError} itself, for the half of a refusal that is not prose. */
function errorOf(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("planSlideWrite: matching slides (0030 §1)", () => {
  it("plans nothing at all for the document the deck itself produced", () => {
    const result = plan(document);
    expect(result.requests).toEqual([]);
    expect(result.entries).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("creates a slide the document gives no id, at the position it holds", () => {
    const added = {
      ...document,
      slides: [
        ...document.slides,
        { layout: "TITLE_AND_BODY", title: "One more thing", body: "And its point" },
      ],
    };
    const result = plan(added);
    expect(result.entries).toEqual([
      {
        action: "create",
        id: "gdrive_slide_1",
        title: "One more thing",
        index: 3,
        fields: ["title", "body"],
      },
    ]);
    const [create, ...text] = result.requests;
    expect(create).toEqual({
      createSlide: {
        objectId: "gdrive_slide_1",
        insertionIndex: 3,
        slideLayoutReference: { layoutId: "L_TB" },
        placeholderIdMappings: [
          { layoutPlaceholder: { type: "TITLE", index: 0 }, objectId: "gdrive_title_1" },
          { layoutPlaceholder: { type: "BODY", index: 0 }, objectId: "gdrive_body_1" },
        ],
      },
    });
    // Never a coordinate: the text goes into the placeholders the layout gave
    // the new slide, addressed by the ids the mapping just assigned (0029 §2).
    expect(text).toEqual([
      { insertText: { objectId: "gdrive_title_1", insertionIndex: 0, text: "One more thing" } },
      { insertText: { objectId: "gdrive_body_1", insertionIndex: 0, text: "And its point" } },
    ]);
  });

  it("refuses an id the deck does not have, rather than creating the slide", () => {
    const wrong = edited(0, { id: "s9" });
    expect(codeOf(() => plan(wrong))).toBe("INVALID_ARGS");
    expect(messageOf(() => plan(wrong))).toContain("s9");
    expect(messageOf(() => plan(wrong))).toContain("drop the id");
  });

  it("refuses a document that names one slide twice", () => {
    const twice = { ...document, slides: [...document.slides, document.slides[0] ?? {}] };
    expect(codeOf(() => plan(twice))).toBe("INVALID_ARGS");
    expect(messageOf(() => plan(twice))).toContain("more than once");
  });

  it("refuses to delete a slide the document dropped, and plans nothing at all", () => {
    const dropped = { ...document, slides: document.slides.slice(0, 2) };
    expect(codeOf(() => plan(dropped))).toBe("PRUNE_REQUIRED");
    const message = messageOf(() => plan(dropped));
    expect(message).toContain("s3");
    expect(message).toContain("--prune");
  });

  /**
   * Issue #31, the deck half. Same rule as `forms write`: 0030 §4 reuses 0028
   * §4's plan wholesale, so a refusal owes the caller the same list a success
   * gives it, in `data` (0031 §3–§4).
   */
  it("carries the slides it refused to delete in the error's data", () => {
    const dropped = { ...document, slides: document.slides.slice(0, 2) };
    const error = errorOf(() => plan(dropped));

    expect(error.code).toBe("PRUNE_REQUIRED");
    expect(error.data?.payload).toEqual({
      id: "1PrEs",
      plan: [{ action: "delete", id: "s3", title: "", index: 2 }],
      applied: false,
    });
    // The same entries `--prune` reports, so one parser reads both answers.
    expect(error.data?.payload).toMatchObject({ plan: plan(dropped, true).entries });
  });

  it("deletes it by object id with --prune", () => {
    const result = plan({ ...document, slides: document.slides.slice(0, 2) }, true);
    expect(result.entries).toEqual([{ action: "delete", id: "s3", title: "", index: 2 }]);
    expect(result.requests).toEqual([{ deleteObject: { objectId: "s3" } }]);
  });

  it("moves a slide the document reordered, backwards so the index is unambiguous", () => {
    const [first, second, third] = document.slides;
    const reordered = { ...document, slides: [third ?? {}, first ?? {}, second ?? {}] };
    const result = plan(reordered);
    expect(result.entries).toEqual([{ action: "move", id: "s3", title: "", from: 2, index: 0 }]);
    expect(result.requests).toEqual([
      { updateSlidesPosition: { slideObjectIds: ["s3"], insertionIndex: 0 } },
    ]);
  });

  it("deletes, then moves, then creates, so every index is the one the deck has", () => {
    const [, second, third] = document.slides;
    const result = plan(
      {
        ...document,
        slides: [third ?? {}, { layout: "BLANK" }, second ?? {}],
      },
      true,
    );
    expect(result.entries.map((entry) => entry.action)).toEqual(["delete", "move", "create"]);
    expect(result.requests).toEqual([
      { deleteObject: { objectId: "s1" } },
      { updateSlidesPosition: { slideObjectIds: ["s3"], insertionIndex: 0 } },
      {
        createSlide: {
          objectId: "gdrive_slide_1",
          insertionIndex: 1,
          slideLayoutReference: { layoutId: "L_BLANK" },
        },
      },
    ]);
  });

  it("marks a slide skipped through the one field of SlideProperties that is writable", () => {
    const result = plan(edited(1, { skipped: true }));
    expect(result.entries).toEqual([
      { action: "update", id: "s2", title: "What we do next", index: 1, fields: ["skipped"] },
    ]);
    expect(result.requests).toEqual([
      {
        updateSlideProperties: {
          objectId: "s2",
          slideProperties: { isSkipped: true },
          fields: "isSkipped",
        },
      },
    ]);
  });
});

describe("planSlideWrite: text (0030 §2)", () => {
  it("rewrites only the placeholder whose text changed, whole", () => {
    const result = plan(edited(0, { title: "The quarter in a sentence" }));
    expect(result.entries).toEqual([
      {
        action: "update",
        id: "s1",
        title: "The quarter in a sentence",
        index: 0,
        fields: ["title"],
      },
    ]);
    // Nothing addresses `b1`: an unedited body is not rewritten, which is what
    // keeps its formatting (0030 §2).
    expect(result.requests).toEqual([
      { deleteText: { objectId: "t1", textRange: { type: "ALL" } } },
      { insertText: { objectId: "t1", insertionIndex: 0, text: "The quarter in a sentence" } },
    ]);
  });

  it("warns on a rewritten placeholder that had more than one text run", () => {
    const result = plan(edited(1, { title: "What we do after" }));
    expect(result.entries[0]).toMatchObject({
      action: "update",
      id: "s2",
      fields: ["title"],
      formatting_loss: ["title"],
    });
  });

  it("says nothing about formatting when the placeholder was a single run", () => {
    const result = plan(edited(0, { title: "The quarter in a sentence" }));
    expect(result.entries[0]?.formatting_loss).toBeUndefined();
  });

  it("clears a placeholder the document dropped the field of", () => {
    const { title: _title, ...withoutTitle } = document.slides[0] ?? {};
    const result = plan({
      ...document,
      slides: document.slides.map((slide, at) => (at === 0 ? withoutTitle : slide)),
    });
    expect(result.requests).toEqual([
      { deleteText: { objectId: "t1", textRange: { type: "ALL" } } },
    ]);
  });

  it("fills a placeholder that was empty, without deleting text it does not have", () => {
    const result = plan(edited(1, { subtitle: "October 2026" }));
    expect(result.requests).toEqual([
      { insertText: { objectId: "sub2", insertionIndex: 0, text: "October 2026" } },
    ]);
  });

  it("writes the speaker notes through the notes page's own shape id", () => {
    const result = plan(edited(0, { notes: "Skip the detail" }));
    expect(result.entries[0]).toMatchObject({ fields: ["notes"] });
    expect(result.requests).toEqual([
      { deleteText: { objectId: "s1_notes", textRange: { type: "ALL" } } },
      { insertText: { objectId: "s1_notes", insertionIndex: 0, text: "Skip the detail" } },
    ]);
  });

  it("keeps the paragraphs of a multi-line body as the newlines the API returned", () => {
    const result = plan(edited(0, { body: "Revenue up 12%\nChurn down 3%" }));
    expect(result.requests[1]).toEqual({
      insertText: { objectId: "b1", insertionIndex: 0, text: "Revenue up 12%\nChurn down 3%" },
    });
  });

  it("reports a field the slide's layout has no placeholder for, rather than dropping it", () => {
    const result = plan(edited(2, { title: "A heading" }));
    expect(result.requests).toEqual([]);
    expect(result.skipped).toEqual([{ index: 2, title: "A heading", kind: "title" }]);
  });

  it("reports a layout change, which no request can carry", () => {
    const result = plan(edited(2, { layout: "TITLE_AND_BODY" }));
    expect(result.requests).toEqual([]);
    expect(result.skipped).toEqual([{ index: 2, title: "", kind: "layout" }]);
  });

  it("reports a renamed deck: the title is a Drive name, not a batchUpdate field", () => {
    const result = plan({ ...document, title: "Q4 review" });
    expect(result.requests).toEqual([]);
    expect(result.skipped).toEqual([{ title: "Q4 review", kind: "presentation.title" }]);
  });
});

describe("planSlideWrite: elements (0030 §3, 0051 §3)", () => {
  const twoColumns: PresentationRaw = {
    presentationId: "1PrEs",
    title: "Deck",
    layouts,
    slides: [
      {
        objectId: "s1",
        slideProperties: { layoutObjectId: "L_2C" },
        pageElements: [
          placeholder("t1", "TITLE", "Two ways to read it"),
          placeholderAt("b1", "BODY", 0, "The left column"),
          placeholderAt("b2", "BODY", 1, "The right column"),
        ],
      },
    ],
  };
  const columnsDocument = toSlideDocument(twoColumns);

  it("plans nothing for a deck whose elements are untouched, so read | write round-trips", () => {
    expect(planSlideWrite(deck, document, { prune: false }).requests).toEqual([]);
    expect(planSlideWrite(twoColumns, columnsDocument, { prune: false }).requests).toEqual([]);
  });

  it("refuses an edited text box, because nothing can honour the change", () => {
    const changed = edited(2, {
      elements: [{ id: "x3", kind: "shape", text: "A heading someone retyped" }],
    });
    expect(codeOf(() => plan(changed))).toBe("INVALID_ARGS");
    const message = messageOf(() => plan(changed));
    expect(message).toContain("x3");
    expect(message).toContain("outside every layout");
  });

  it("refuses a displaced placeholder differently: the write is not implemented", () => {
    const changed = {
      ...columnsDocument,
      slides: columnsDocument.slides.map((slide) => ({
        ...slide,
        elements: [{ id: "b2", kind: "shape" as const, placeholder: "BODY", text: "Rewritten" }],
      })),
    };
    const run = () => planSlideWrite(twoColumns, changed, { prune: false });
    expect(codeOf(run)).toBe("INVALID_ARGS");
    const message = messageOf(run);
    expect(message).toContain("b2");
    expect(message).toContain("BODY");
    expect(message).toContain("not implemented");
    expect(message).toContain("issues/28");
    // The API could rewrite it, so the message must not claim otherwise.
    expect(message).not.toContain("outside every layout");
  });

  it("refuses an added element and a removed one on the same terms", () => {
    const added = edited(2, {
      elements: [
        { id: "x3", kind: "shape" as const, text: "A heading someone placed by hand" },
        { id: "x4", kind: "shape" as const, text: "And another" },
      ],
    });
    expect(codeOf(() => plan(added))).toBe("INVALID_ARGS");
    expect(messageOf(() => plan(added))).toContain("x4");

    const removed = edited(2, { elements: [] });
    expect(codeOf(() => plan(removed))).toBe("INVALID_ARGS");
    expect(messageOf(() => plan(removed))).toContain("x3");
  });

  /**
   * The comparison is positional, so the entry at index 0 no longer matches
   * when one is put in front of it. Saying its text changed would send the
   * reader to look at an entry nobody touched; the count is what actually
   * differs, and it is what the refusal reports.
   */
  it("does not call an inserted element a changed one", () => {
    const prepended = edited(2, {
      elements: [
        { id: "x0", kind: "shape" as const, text: "Pasted in front" },
        { id: "x3", kind: "shape" as const, text: "A heading someone placed by hand" },
      ],
    });
    const message = messageOf(() => plan(prepended));
    expect(message).toContain("the document lists 2 elements where the slide has 1");
    expect(message).not.toContain("the text of an element changed");
  });

  it("still says the text changed when the counts match", () => {
    const changed = edited(2, {
      elements: [{ id: "x3", kind: "shape" as const, text: "A heading someone retyped" }],
    });
    expect(messageOf(() => plan(changed))).toContain("the text of an element changed");
  });

  it("names an entry with no id in words, since it cannot name it by id", () => {
    const anonymous = edited(2, {
      elements: [
        { id: "x3", kind: "shape" as const, text: "A heading someone placed by hand" },
        { kind: "shape" as const, text: "Hand-written, with no id" },
      ],
    });
    expect(messageOf(() => plan(anonymous))).toContain("an entry with no id is a shape");
  });

  it("leaves a new slide's elements out and says so, rather than failing the write", () => {
    const added = {
      ...document,
      slides: [
        ...document.slides,
        {
          layout: "BLANK",
          elements: [{ id: "x9", kind: "shape" as const, text: "Pasted from somewhere" }],
        },
      ],
    };
    const result = plan(added);
    expect(result.skipped).toEqual([{ index: 3, title: "", kind: "elements" }]);
    expect(result.requests).toEqual([
      {
        createSlide: {
          objectId: "gdrive_slide_1",
          insertionIndex: 3,
          slideLayoutReference: { layoutId: "L_BLANK" },
        },
      },
    ]);
  });
});

describe("planSlideWrite: layouts", () => {
  it("names a layout of the deck by id, so it cannot resolve against another master", () => {
    const result = plan({
      ...document,
      slides: [...document.slides, { layout: "TITLE", title: "Q4" }],
    });
    expect(result.requests[0]).toMatchObject({
      createSlide: { slideLayoutReference: { layoutId: "L_T" } },
    });
  });

  it("takes the layout's own placeholder types, not the document's field names", () => {
    const result = plan({
      ...document,
      slides: [...document.slides, { layout: "TITLE", title: "Q4", subtitle: "October" }],
    });
    // A title slide's heading is a CENTERED_TITLE; asking for TITLE would map
    // no placeholder and leave the text nowhere to go.
    expect(result.requests[0]).toMatchObject({
      createSlide: {
        placeholderIdMappings: [
          { layoutPlaceholder: { type: "CENTERED_TITLE", index: 0 }, objectId: "gdrive_title_1" },
          { layoutPlaceholder: { type: "SUBTITLE", index: 0 }, objectId: "gdrive_subtitle_1" },
        ],
      },
    });
  });

  it("falls back to the predefined layout when the deck reports no layouts at all", () => {
    const bare: PresentationRaw = { presentationId: "1PrEs", title: "Deck", slides: [] };
    const result = planSlideWrite(
      bare,
      { title: "Deck", slides: [{ layout: "TITLE_AND_BODY", title: "Hello" }] },
      { prune: false },
    );
    expect(result.requests[0]).toMatchObject({
      createSlide: { slideLayoutReference: { predefinedLayout: "TITLE_AND_BODY" } },
    });
    // With no layout to read placeholders off, the text has nowhere to go and
    // is reported rather than silently dropped.
    expect(result.skipped).toEqual([{ index: 0, title: "Hello", kind: "title" }]);
  });

  it("refuses a layout name neither the deck nor Slides knows", () => {
    const run = () =>
      plan({ ...document, slides: [...document.slides, { layout: "FANCY", title: "Q4" }] });
    expect(codeOf(run)).toBe("INVALID_ARGS");
    expect(messageOf(run)).toContain("FANCY");
  });

  it("gives a slide with no layout at all the API's own default", () => {
    const result = plan({ ...document, slides: [...document.slides, {}] });
    expect(result.requests).toEqual([
      { createSlide: { objectId: "gdrive_slide_1", insertionIndex: 3 } },
    ]);
  });

  it("does not reuse an id the deck already has", () => {
    const taken: PresentationRaw = {
      ...deck,
      slides: [{ objectId: "gdrive_slide_1", slideProperties: { layoutObjectId: "L_BLANK" } }],
    };
    const result = planSlideWrite(
      taken,
      { title: "Q3 review", slides: [{ id: "gdrive_slide_1" }, { layout: "BLANK" }] },
      { prune: false },
    );
    expect(result.requests[0]).toMatchObject({ createSlide: { objectId: "gdrive_slide_2" } });
  });
});

describe("planSlideCreate (0030 §4)", () => {
  /** What `presentations.create` hands back: a title, a theme, and one slide. */
  const fresh: PresentationRaw = {
    presentationId: "1NeWdEcK",
    title: "Q4 review",
    layouts,
    slides: [{ objectId: "p", slideProperties: { layoutObjectId: "L_TB" } }],
  };

  it("removes Slides' default slide and builds the document's in one batch", () => {
    const result = planSlideCreate(fresh, document, "Q4 review");
    expect(result.requests[0]).toEqual({ deleteObject: { objectId: "p" } });
    expect(result.entries[0]).toEqual({ action: "delete", id: "p", title: "", index: 0 });
    expect(result.requests.filter((request) => "createSlide" in request)).toHaveLength(3);
  });

  it("ignores the ids the document was read with, so a copy is a copy", () => {
    const result = planSlideCreate(fresh, document, "Q4 review");
    expect(result.entries.filter((entry) => entry.action === "update")).toEqual([]);
    expect(result.entries.filter((entry) => entry.action === "create")).toHaveLength(3);
  });

  it("says nothing about the title, which the command's argument already set", () => {
    expect(planSlideCreate(fresh, document, "Q4 review").skipped).toEqual([
      // A new slide's notes page has no id yet, and no create can reproduce the
      // hand-placed box of slide 3. Both are reported; neither fails the copy.
      { index: 0, title: "The quarter in one slide", kind: "notes" },
      { index: 2, title: "", kind: "elements" },
    ]);
  });
});
