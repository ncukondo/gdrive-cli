import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown-doc.ts";
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
      { kind: "list", ordered: true, level: 0, spans: [{ text: "one" }] },
      { kind: "list", ordered: true, level: 1, spans: [{ text: "two" }] },
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
          ? { bullet: { listId: options.bullet.listId, nestingLevel: options.bullet.nestingLevel ?? 0 } }
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
      { kind: "list", ordered: true, level: 0, spans: [{ text: "one" }] },
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
