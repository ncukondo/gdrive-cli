import { describe, expect, it } from "vitest";
import {
  parseMarkdown,
  planCellFills,
  planTable,
  planTextRun,
  toSegments,
} from "./markdown-doc.ts";
import { renderDocument, type DocumentRaw, type StructuralElementRaw } from "./docs-api.ts";

describe("parseMarkdown — blocks", () => {
  it("maps ATX headings to their level", () => {
    const { blocks } = parseMarkdown("# One\n### Three\n###### Six");
    expect(blocks).toEqual([
      { kind: "heading", level: 1, spans: [{ text: "One" }] },
      { kind: "heading", level: 3, spans: [{ text: "Three" }] },
      { kind: "heading", level: 6, spans: [{ text: "Six" }] },
    ]);
  });

  it("keeps one paragraph per line, because that is what read emits", () => {
    const { blocks } = parseMarkdown("first line\nsecond line\n\nafter a blank");
    expect(blocks).toEqual([
      { kind: "paragraph", spans: [{ text: "first line" }] },
      { kind: "paragraph", spans: [{ text: "second line" }] },
      { kind: "paragraph", spans: [{ text: "after a blank" }] },
    ]);
  });

  it("reads bulleted and numbered lists, nesting two spaces per level", () => {
    const { blocks } = parseMarkdown("- top\n  - nested\n1. one\n  2) two");
    expect(blocks).toEqual([
      { kind: "list", ordered: false, level: 0, spans: [{ text: "top" }] },
      { kind: "list", ordered: false, level: 1, spans: [{ text: "nested" }] },
      { kind: "list", ordered: true, level: 0, number: 1, spans: [{ text: "one" }] },
      { kind: "list", ordered: true, level: 1, number: 2, spans: [{ text: "two" }] },
    ]);
  });

  it("reads a pipe table with its separator row", () => {
    const { blocks } = parseMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |\nafter");
    expect(blocks).toEqual([
      {
        kind: "table",
        rows: [
          [[{ text: "a" }], [{ text: "b" }]],
          [[{ text: "1" }], [{ text: "2" }]],
        ],
      },
      { kind: "paragraph", spans: [{ text: "after" }] },
    ]);
  });

  it("treats a pipe line with no separator row as a paragraph", () => {
    const { blocks } = parseMarkdown("| a | b |\nnot a table");
    expect(blocks).toEqual([
      { kind: "paragraph", spans: [{ text: "| a | b |" }] },
      { kind: "paragraph", spans: [{ text: "not a table" }] },
    ]);
  });
});

/**
 * Decision 0023 §1: ordered items separated by non-list blocks belong to one
 * Docs list when their numbers continue. `continues` marks the item that joins
 * the list the previous run opened, so nothing downstream has to re-derive it.
 */
describe("parseMarkdown — ordered runs continue across other blocks (0023 §1)", () => {
  const numbers = (source: string) =>
    parseMarkdown(source).blocks.map((b) =>
      b.kind === "list" ? `${b.number ?? "-"}${b.continues === true ? "+" : ""}` : b.kind,
    );

  it("joins numbered sections separated by their body paragraphs", () => {
    expect(numbers("1. one\n\nbody one\n\n2. two\n\nbody two\n\n3. three")).toEqual([
      "1",
      "paragraph",
      "2+",
      "paragraph",
      "3+",
    ]);
  });

  it("continues across a heading, a quote, and a code block", () => {
    expect(
      numbers("1. one\n\n## head\n\n2. two\n\n> quoted\n\n3. three\n\n```\nls\n```\n\n4. four"),
    ).toEqual(["1", "heading", "2+", "quote", "3+", "code", "4+"]);
  });

  it("continues across a bulleted list, which stays its own list", () => {
    expect(numbers("1. one\n\n- a\n- b\n\n2. two")).toEqual(["1", "-", "-", "2+"]);
  });

  it("counts the items of a contiguous run, so the next number is the one after it", () => {
    expect(numbers("1. one\n2. two\n\nbody\n\n3. three")).toEqual(["1", "2", "paragraph", "3+"]);
  });

  it("counts only level-0 items, so a sub-list does not consume a number", () => {
    expect(numbers("1. one\n  1. sub\n  2. sub\n\nbody\n\n2. two")).toEqual([
      "1",
      "1",
      "2",
      "paragraph",
      "2+",
    ]);
  });

  it("starts a new list when the numbering restarts at 1", () => {
    expect(numbers("1. one\n\nbody\n\n1. one again")).toEqual(["1", "paragraph", "1"]);
  });

  it("ends the run at a table (0023 §4)", () => {
    expect(numbers("1. one\n\n| a |\n| --- |\n| b |\n\n2. two")).toEqual([
      "1",
      "table",
      "paragraph",
    ]);
  });
});

/**
 * Decision 0023 §3: a run that starts at anything but 1 is not expressible —
 * `startNumber` is read-only — so it keeps its ordinals as literal text rather
 * than being silently renumbered from 1.
 */
describe("parseMarkdown — a run that does not start at 1 stays text (0023 §3)", () => {
  it("keeps the ordinals of a run starting at 5", () => {
    const { blocks } = parseMarkdown("5. five\n6. six\n7. seven");
    expect(blocks).toEqual([
      { kind: "paragraph", spans: [{ text: "5. " }, { text: "five" }] },
      { kind: "paragraph", spans: [{ text: "6. " }, { text: "six" }] },
      { kind: "paragraph", spans: [{ text: "7. " }, { text: "seven" }] },
    ]);
  });

  it("keeps the inline styling of an item it turns back into text", () => {
    const { blocks } = parseMarkdown("2. a **bold** word");
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        spans: [{ text: "2. " }, { text: "a " }, { text: "bold", bold: true }, { text: " word" }],
      },
    ]);
  });

  it("keeps the delimiter it was written with", () => {
    expect(parseMarkdown("2) two").blocks).toEqual([
      { kind: "paragraph", spans: [{ text: "2) " }, { text: "two" }] },
    ]);
  });

  it("makes a run starting at 1) an ordinary list, losing only the delimiter", () => {
    expect(parseMarkdown("1) one\n2) two").blocks).toEqual([
      { kind: "list", ordered: true, level: 0, number: 1, spans: [{ text: "one" }] },
      { kind: "list", ordered: true, level: 0, number: 2, spans: [{ text: "two" }] },
    ]);
  });

  it("treats 0 as not starting at 1, so its ordinals survive too", () => {
    expect(parseMarkdown("0. zero").blocks).toEqual([
      { kind: "paragraph", spans: [{ text: "0. " }, { text: "zero" }] },
    ]);
  });
});

describe("parseMarkdown — inline", () => {
  it("reads bold, italic, and links", () => {
    const { blocks } = parseMarkdown("plain **bold** and *italic* and [text](https://e.com).");
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        spans: [
          { text: "plain " },
          { text: "bold", bold: true },
          { text: " and " },
          { text: "italic", italic: true },
          { text: " and " },
          { text: "text", link: "https://e.com" },
          { text: "." },
        ],
      },
    ]);
  });

  it("reads the combination the renderer emits for a styled link", () => {
    const { blocks } = parseMarkdown("[**bold link**](https://e.com)");
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        spans: [{ text: "bold link", bold: true, link: "https://e.com" }],
      },
    ]);
  });

  it("keeps unmatched markup as literal text", () => {
    const { blocks } = parseMarkdown("2 * 3 = 6 and a [ bracket and ~~strike~~");
    expect(blocks).toEqual([
      { kind: "paragraph", spans: [{ text: "2 * 3 = 6 and a [ bracket and ~~strike~~" }] },
    ]);
  });

  it("unescapes a backslash-escaped marker", () => {
    const { blocks } = parseMarkdown("literal \\*stars\\* here");
    expect(blocks).toEqual([{ kind: "paragraph", spans: [{ text: "literal *stars* here" }] }]);
  });

  it("styles table cells", () => {
    const { blocks } = parseMarkdown("| **a** | b |\n| --- | --- |");
    expect(blocks).toEqual([
      { kind: "table", rows: [[[{ text: "a", bold: true }], [{ text: "b" }]]] },
    ]);
  });

  /** Decision 0023 §6: the native import links all three of these, so we do. */
  describe("links (0023 §6)", () => {
    it("reads an autolink on its own line, and no longer calls it raw HTML", () => {
      const { blocks, unsupported } = parseMarkdown("<https://meet.example.com/abc>");
      expect(blocks).toEqual([
        {
          kind: "paragraph",
          spans: [{ text: "https://meet.example.com/abc", link: "https://meet.example.com/abc" }],
        },
      ]);
      expect(unsupported).toEqual([]);
    });

    it("reads an autolink mid-line", () => {
      const { blocks } = parseMarkdown("会議場所：<https://meet.example.com/abc> です");
      expect(blocks).toEqual([
        {
          kind: "paragraph",
          spans: [
            { text: "会議場所：" },
            { text: "https://meet.example.com/abc", link: "https://meet.example.com/abc" },
            { text: " です" },
          ],
        },
      ]);
    });

    it("takes any scheme inside angle brackets, and shows the URI as written", () => {
      const { blocks } = parseMarkdown("<mailto:a@example.com>");
      expect(blocks).toEqual([
        {
          kind: "paragraph",
          spans: [{ text: "mailto:a@example.com", link: "mailto:a@example.com" }],
        },
      ]);
    });

    it("links a bare http(s) URL, and only those", () => {
      expect(parseMarkdown("see https://example.com/x now").blocks).toEqual([
        {
          kind: "paragraph",
          spans: [
            { text: "see " },
            { text: "https://example.com/x", link: "https://example.com/x" },
            { text: " now" },
          ],
        },
      ]);
      expect(parseMarkdown("see ftp://example.com/x now").blocks).toEqual([
        { kind: "paragraph", spans: [{ text: "see ftp://example.com/x now" }] },
      ]);
    });

    it("leaves trailing sentence punctuation out of a bare URL", () => {
      expect(parseMarkdown("at https://example.com/x.").blocks).toEqual([
        {
          kind: "paragraph",
          spans: [
            { text: "at " },
            { text: "https://example.com/x", link: "https://example.com/x" },
            { text: "." },
          ],
        },
      ]);
    });

    it("does not re-link the URL inside an ordinary link", () => {
      expect(parseMarkdown("[text](https://example.com)").blocks).toEqual([
        { kind: "paragraph", spans: [{ text: "text", link: "https://example.com" }] },
      ]);
    });

    it("still reports a real HTML tag at the start of a line", () => {
      const { unsupported } = parseMarkdown('<div class="x">');
      expect(unsupported).toEqual([{ line: 1, kind: "html" }]);
    });
  });
});

describe("parseMarkdown — everything outside the subset still lands (decision 0021 §3)", () => {
  it("maps a fenced block and an inline code span to code", () => {
    const { blocks, unsupported } = parseMarkdown(
      "```sh\nls -l\n# not a heading\n```\na `span` too",
    );
    expect(blocks).toEqual([
      { kind: "code", text: "ls -l\n# not a heading" },
      {
        kind: "paragraph",
        spans: [{ text: "a " }, { text: "span", code: true }, { text: " too" }],
      },
    ]);
    expect(unsupported).toEqual([]);
  });

  it("maps an indented block to code, but leaves a nested list item alone", () => {
    const { blocks } = parseMarkdown("    indented code\n\n- top\n    - deep");
    expect(blocks).toEqual([
      { kind: "code", text: "indented code" },
      { kind: "list", ordered: false, level: 0, spans: [{ text: "top" }] },
      { kind: "list", ordered: false, level: 2, spans: [{ text: "deep" }] },
    ]);
  });

  it("maps a block quote to a quote block", () => {
    const { blocks } = parseMarkdown("> quoted **text**");
    expect(blocks).toEqual([
      { kind: "quote", spans: [{ text: "quoted " }, { text: "text", bold: true }] },
    ]);
  });

  it("drops a horizontal rule", () => {
    const { blocks } = parseMarkdown("before\n\n---\n\nafter");
    expect(blocks).toEqual([
      { kind: "paragraph", spans: [{ text: "before" }] },
      { kind: "paragraph", spans: [{ text: "after" }] },
    ]);
  });

  it("keeps an image literal and reports it with its line", () => {
    const { blocks, unsupported } = parseMarkdown("intro\n![alt](https://e.com/x.png)");
    expect(blocks).toEqual([
      { kind: "paragraph", spans: [{ text: "intro" }] },
      { kind: "paragraph", spans: [{ text: "![alt](https://e.com/x.png)" }] },
    ]);
    expect(unsupported).toEqual([{ line: 2, kind: "image" }]);
  });

  it("keeps raw HTML literal and reports it with its line", () => {
    const { blocks, unsupported } = parseMarkdown('<div class="x">\ntext\n</div>');
    expect(blocks).toEqual([
      { kind: "paragraph", spans: [{ text: '<div class="x">' }] },
      { kind: "paragraph", spans: [{ text: "text" }] },
      { kind: "paragraph", spans: [{ text: "</div>" }] },
    ]);
    expect(unsupported).toEqual([
      { line: 1, kind: "html" },
      { line: 3, kind: "html" },
    ]);
  });

  it("never throws: no input is rejected", () => {
    expect(() => parseMarkdown("| broken |\n> ```\n#\n![](x)")).not.toThrow();
  });
});

/**
 * The contract of decision 0021 §2: whatever `docs read --as markdown` prints
 * must parse back to the structure it came from. `read`'s output is the
 * contract, so a mismatch is a bug on whichever side is wrong.
 */
describe("round trip with renderDocument", () => {
  type Run = { text: string; bold?: boolean; italic?: boolean; url?: string };

  function para(
    runs: (string | Run)[],
    options: { style?: string; bullet?: { listId: string; nestingLevel?: number } } = {},
  ): StructuralElementRaw {
    return {
      paragraph: {
        elements: runs.map((r) => {
          const run: Run = typeof r === "string" ? { text: r } : r;
          return {
            textRun: {
              content: run.text,
              textStyle: {
                ...(run.bold ? { bold: true } : {}),
                ...(run.italic ? { italic: true } : {}),
                ...(run.url ? { link: { url: run.url } } : {}),
              },
            },
          };
        }),
        ...(options.style ? { paragraphStyle: { namedStyleType: options.style } } : {}),
        ...(options.bullet
          ? {
              bullet: {
                listId: options.bullet.listId,
                nestingLevel: options.bullet.nestingLevel ?? 0,
              },
            }
          : {}),
      },
    };
  }

  function table(rows: (string | Run)[][][]): StructuralElementRaw {
    return {
      table: {
        tableRows: rows.map((row) => ({
          tableCells: row.map((cell) => ({ content: [para(cell)] })),
        })),
      },
    };
  }

  const roundTrip = (document: DocumentRaw) => parseMarkdown(renderDocument(document, "markdown"));

  it("survives a heading and a styled paragraph", () => {
    const { blocks } = roundTrip({
      body: {
        content: [
          para(["Meeting notes"], { style: "HEADING_1" }),
          para([
            "Discussed the ",
            { text: "budget", bold: true },
            " and ",
            { text: "the plan", url: "https://example.com" },
            ".",
          ]),
        ],
      },
    });

    expect(blocks).toEqual([
      { kind: "heading", level: 1, spans: [{ text: "Meeting notes" }] },
      {
        kind: "paragraph",
        spans: [
          { text: "Discussed the " },
          { text: "budget", bold: true },
          { text: " and " },
          { text: "the plan", link: "https://example.com" },
          { text: "." },
        ],
      },
    ]);
  });

  it("survives a nested mixed list", () => {
    const { blocks } = roundTrip({
      body: {
        content: [
          para(["top"], { bullet: { listId: "L1" } }),
          para(["nested"], { bullet: { listId: "L1", nestingLevel: 1 } }),
          para(["one"], { bullet: { listId: "L2" } }),
        ],
      },
      lists: {
        L1: { listProperties: { nestingLevels: [{ glyphSymbol: "●" }, { glyphSymbol: "○" }] } },
        L2: { listProperties: { nestingLevels: [{ glyphType: "DECIMAL" }] } },
      },
    });

    expect(blocks).toEqual([
      { kind: "list", ordered: false, level: 0, spans: [{ text: "top" }] },
      { kind: "list", ordered: false, level: 1, spans: [{ text: "nested" }] },
      { kind: "list", ordered: true, level: 0, number: 1, spans: [{ text: "one" }] },
    ]);
  });

  it("survives one numbered list whose items are separated by paragraphs", () => {
    const { blocks } = roundTrip({
      body: {
        content: [
          para(["one"], { bullet: { listId: "L1" } }),
          para(["body of one"]),
          para(["two"], { bullet: { listId: "L1" } }),
          para(["body of two"]),
          para(["three"], { bullet: { listId: "L1" } }),
        ],
      },
      lists: { L1: { listProperties: { nestingLevels: [{ glyphType: "DECIMAL" }] } } },
    });

    expect(blocks).toEqual([
      { kind: "list", ordered: true, level: 0, number: 1, spans: [{ text: "one" }] },
      { kind: "paragraph", spans: [{ text: "body of one" }] },
      {
        kind: "list",
        ordered: true,
        level: 0,
        number: 2,
        continues: true,
        spans: [{ text: "two" }],
      },
      { kind: "paragraph", spans: [{ text: "body of two" }] },
      {
        kind: "list",
        ordered: true,
        level: 0,
        number: 3,
        continues: true,
        spans: [{ text: "three" }],
      },
    ]);
  });

  /**
   * The one construct 0021 §2 cannot hold, recorded as decision 0023 §3 rather
   * than left to be discovered. `startNumber` is read-only, so a list that
   * starts at 5 reads back as `5. …` and parses to paragraphs: the Markdown
   * round-trips, the Docs structure does not.
   */
  it("does not round-trip a list that starts at 5 — the documented exception", () => {
    const document: DocumentRaw = {
      body: {
        content: [
          para(["five"], { bullet: { listId: "L1" } }),
          para(["six"], { bullet: { listId: "L1" } }),
        ],
      },
      lists: {
        L1: { listProperties: { nestingLevels: [{ glyphType: "DECIMAL", startNumber: 5 }] } },
      },
    };

    expect(renderDocument(document, "markdown")).toBe("5. five\n6. six");
    expect(parseMarkdown(renderDocument(document, "markdown")).blocks).toEqual([
      { kind: "paragraph", spans: [{ text: "5. " }, { text: "five" }] },
      { kind: "paragraph", spans: [{ text: "6. " }, { text: "six" }] },
    ]);
  });

  it("survives a table whose cells carry inline styles", () => {
    const { blocks } = roundTrip({
      body: {
        content: [
          table([
            [[{ text: "枠", bold: true }], [{ text: "企画名" }]],
            [[{ text: "1" }], [{ text: "Ops", italic: true }]],
          ]),
        ],
      },
    });

    expect(blocks).toEqual([
      {
        kind: "table",
        rows: [
          [[{ text: "枠", bold: true }], [{ text: "企画名" }]],
          [[{ text: "1" }], [{ text: "Ops", italic: true }]],
        ],
      },
    ]);
  });
});

describe("planTextRun", () => {
  const blocks = parseMarkdown("# Title\nplain **bold**\n- item").blocks;

  it("inserts the whole run once, then styles it back to front", () => {
    const { requests, length } = planTextRun(blocks, 1);

    // "Title\n" [1,7)  "plain bold\n" [7,18)  "item\n" [18,23)
    expect(requests).toEqual([
      { insertText: { location: { index: 1 }, text: "Title\nplain bold\nitem\n" } },
      {
        createParagraphBullets: {
          range: { startIndex: 18, endIndex: 23 },
          bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
        },
      },
      {
        updateTextStyle: {
          range: { startIndex: 13, endIndex: 17 },
          textStyle: { bold: true },
          fields: "bold",
        },
      },
      {
        updateParagraphStyle: {
          range: { startIndex: 1, endIndex: 7 },
          paragraphStyle: { namedStyleType: "HEADING_1" },
          fields: "namedStyleType",
        },
      },
    ]);
    expect(length).toBe(22);
  });

  it("offsets every range by the start index", () => {
    const { requests } = planTextRun(blocks, 101);
    expect(requests[0]).toEqual({
      insertText: { location: { index: 101 }, text: "Title\nplain bold\nitem\n" },
    });
    expect(requests[3]).toEqual({
      updateParagraphStyle: {
        range: { startIndex: 101, endIndex: 107 },
        paragraphStyle: { namedStyleType: "HEADING_1" },
        fields: "namedStyleType",
      },
    });
  });

  it("bullets a whole list in one request, so the tabs become nesting", () => {
    const { requests } = planTextRun(parseMarkdown("- top\n  - deep\n- back").blocks, 1);
    expect(requests[0]).toEqual({
      insertText: { location: { index: 1 }, text: "top\n\tdeep\nback\n" },
    });
    const bullets = requests.filter((r) => "createParagraphBullets" in r);
    expect(bullets).toEqual([
      {
        createParagraphBullets: {
          range: { startIndex: 1, endIndex: 16 },
          bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
        },
      },
    ]);
  });

  it("reports the length the bullets leave behind, not the text sent", () => {
    // "top\n\tdeep\nback\n" is 15 characters, and the tab does not survive.
    expect(planTextRun(parseMarkdown("- top\n  - deep\n- back").blocks, 1).length).toBe(14);
  });

  it("starts a new list when the run changes between bullets and numbers", () => {
    const { requests } = planTextRun(parseMarkdown("- a\n1. b").blocks, 1);
    const presets = requests.flatMap((r) =>
      "createParagraphBullets" in r ? [r.createParagraphBullets.bulletPreset] : [],
    );
    expect(presets).toEqual(["NUMBERED_DECIMAL_ALPHA_ROMAN", "BULLET_DISC_CIRCLE_SQUARE"]);
  });

  /**
   * Decision 0023 §2. `startNumber` is read-only, so one list across
   * interleaved content is built by bulleting the whole span and then taking
   * the intervening runs back out. Step 3 cannot replace step 2: a second
   * preset applied to a sub-range restyles the whole list.
   */
  describe("one list across interleaved content (0023 §2)", () => {
    it("bullets the whole span, then unbullets the paragraph between the items", () => {
      const { requests, length } = planTextRun(parseMarkdown("1. one\n\nbody\n\n2. two").blocks, 1);
      expect(requests).toEqual([
        { insertText: { location: { index: 1 }, text: "one\nbody\ntwo\n" } },
        {
          createParagraphBullets: {
            range: { startIndex: 1, endIndex: 14 },
            bulletPreset: "NUMBERED_DECIMAL_ALPHA_ROMAN",
          },
        },
        { deleteParagraphBullets: { range: { startIndex: 5, endIndex: 10 } } },
      ]);
      expect(length).toBe(13);
    });

    /**
     * The known cost of 0023 §2's sweep: the span deletes every leading tab in
     * it, including the ones inside an intervening run, so the request that
     * re-bullets that run has nothing left to read a nesting level from. The
     * tab is still sent — it is what the sweep consumes — but the sub-item
     * comes back flat.
     */
    it("flattens a sub-list inside an intervening run, whose tabs the sweep ate", () => {
      const { requests } = planTextRun(parseMarkdown("1. one\n\n- a\n  - b\n\n2. two").blocks, 1);
      expect(requests[0]).toEqual({
        insertText: { location: { index: 1 }, text: "one\na\n\tb\ntwo\n" },
      });
      // [5,9) is "a\n" and "b\n" once the tab is gone — the range is right, but
      // by then nothing distinguishes "b" as nested.
      expect(requests[3]).toEqual({
        createParagraphBullets: {
          range: { startIndex: 5, endIndex: 9 },
          bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
        },
      });
    });

    it("gives an intervening bulleted run its own list, after taking it out of this one", () => {
      const { requests } = planTextRun(parseMarkdown("1. one\n\n- a\n- b\n\n2. two").blocks, 1);
      expect(requests.slice(1)).toEqual([
        {
          createParagraphBullets: {
            range: { startIndex: 1, endIndex: 13 },
            bulletPreset: "NUMBERED_DECIMAL_ALPHA_ROMAN",
          },
        },
        { deleteParagraphBullets: { range: { startIndex: 5, endIndex: 9 } } },
        {
          createParagraphBullets: {
            range: { startIndex: 5, endIndex: 9 },
            bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
          },
        },
      ]);
    });

    it("restyles an intervening heading after the bullets, which would have wiped it", () => {
      const { requests } = planTextRun(parseMarkdown("1. one\n\n## head\n\n2. two").blocks, 1);
      expect(requests.slice(1)).toEqual([
        {
          createParagraphBullets: {
            range: { startIndex: 1, endIndex: 14 },
            bulletPreset: "NUMBERED_DECIMAL_ALPHA_ROMAN",
          },
        },
        { deleteParagraphBullets: { range: { startIndex: 5, endIndex: 10 } } },
        {
          updateParagraphStyle: {
            range: { startIndex: 5, endIndex: 10 },
            paragraphStyle: { namedStyleType: "HEADING_2" },
            fields: "namedStyleType",
          },
        },
      ]);
    });

    it("moves the later ranges back by the tabs the first request deletes", () => {
      const { requests, length } = planTextRun(
        parseMarkdown("1. one\n  1. sub\n\nbody\n\n2. two").blocks,
        1,
      );
      expect(requests[0]).toEqual({
        insertText: { location: { index: 1 }, text: "one\n\tsub\nbody\ntwo\n" },
      });
      // "body\n" sits at [10,15) as sent, and at [9,14) once the tab is gone.
      expect(requests[2]).toEqual({
        deleteParagraphBullets: { range: { startIndex: 9, endIndex: 14 } },
      });
      expect(length).toBe(17);
    });

    it("leaves a lone run exactly as it was, with no unbulleting", () => {
      const { requests } = planTextRun(parseMarkdown("1. one\n2. two").blocks, 1);
      expect(requests.some((r) => "deleteParagraphBullets" in r)).toBe(false);
    });
  });

  it("maps a quote to an indent and code to a monospace run", () => {
    const { requests } = planTextRun(parseMarkdown("> quoted\n\n```\nls\n```").blocks, 1);
    expect(requests).toEqual([
      { insertText: { location: { index: 1 }, text: "quoted\nls\n" } },
      {
        updateTextStyle: {
          range: { startIndex: 8, endIndex: 10 },
          textStyle: { weightedFontFamily: { fontFamily: "Courier New" } },
          fields: "weightedFontFamily",
        },
      },
      {
        updateParagraphStyle: {
          range: { startIndex: 1, endIndex: 8 },
          paragraphStyle: { indentStart: { magnitude: 36, unit: "PT" } },
          fields: "indentStart",
        },
      },
    ]);
  });

  it("carries a link across a styled span", () => {
    const { requests } = planTextRun(parseMarkdown("[**x**](https://e.com)").blocks, 1);
    expect(requests[1]).toEqual({
      updateTextStyle: {
        range: { startIndex: 1, endIndex: 2 },
        textStyle: { bold: true, link: { url: "https://e.com" } },
        fields: "bold,link",
      },
    });
  });

  it("prepends a paragraph break when the caller asks for one", () => {
    const { requests, length } = planTextRun(parseMarkdown("tail").blocks, 9, {
      leadingNewline: true,
    });
    expect(requests[0]).toEqual({ insertText: { location: { index: 9 }, text: "\ntail\n" } });
    expect(length).toBe(6);
  });
});

describe("toSegments / planTable / planCellFills", () => {
  const blocks = parseMarkdown("intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter").blocks;

  it("splits at the table, keeping the text on either side", () => {
    expect(toSegments(blocks).map((s) => s.kind)).toEqual(["text", "table", "text"]);
  });

  it("creates the table empty, sized from the parsed rows", () => {
    const segment = toSegments(blocks)[1];
    const rows = segment?.kind === "table" ? segment.rows : [];
    expect(planTable(rows, 7)).toEqual({
      insertTable: { location: { index: 7 }, rows: 2, columns: 2 },
    });
    expect(planTable([], 7)).toBeNull();
  });

  it("fills the cells the re-read reports, in descending index order", () => {
    const segment = toSegments(blocks)[1];
    const rows = segment?.kind === "table" ? segment.rows : [];
    const table = {
      tableRows: [
        { tableCells: [{ content: [{ startIndex: 10 }] }, { content: [{ startIndex: 12 }] }] },
        { tableCells: [{ content: [{ startIndex: 15 }] }, { content: [{ startIndex: 17 }] }] },
      ],
    };

    expect(planCellFills(table, rows)).toEqual({
      requests: [
        { insertText: { location: { index: 17 }, text: "2" } },
        { insertText: { location: { index: 15 }, text: "1" } },
        { insertText: { location: { index: 12 }, text: "b" } },
        { insertText: { location: { index: 10 }, text: "a" } },
      ],
      added: 4,
    });
  });
});
