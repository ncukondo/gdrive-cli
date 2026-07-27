import { describe, expect, it, vi } from "vitest";
import { callArgs } from "../../tests/helpers/mock.ts";
import {
  createDocument,
  findMarkerRanges,
  insertMarkdown,
  replaceMarkdown,
  endOfBody,
  getDocument,
  insertText,
  renderDocument,
  replaceAllText,
  type DocsClient,
  type DocumentRaw,
  type StructuralElementRaw,
} from "./docs-api.ts";

/** Builds a paragraph structural element from styled text runs. */
function para(
  runs: (string | { text: string; bold?: boolean; italic?: boolean; url?: string })[],
  options: { style?: string; bullet?: { listId: string; nestingLevel?: number } } = {},
): StructuralElementRaw {
  return {
    paragraph: {
      elements: runs.map((r) => {
        const run = typeof r === "string" ? { text: r } : r;
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

function doc(content: StructuralElementRaw[], overrides: Partial<DocumentRaw> = {}): DocumentRaw {
  return { documentId: "D1", title: "Meeting notes", body: { content }, ...overrides };
}

function mockDocs(overrides: Partial<DocsClient["documents"]> = {}): DocsClient {
  return {
    documents: {
      get: vi.fn(async () => ({ data: doc([]) })),
      create: vi.fn(async () => ({ data: doc([]) })),
      batchUpdate: vi.fn(async () => ({ data: {} })),
      ...overrides,
    },
  };
}

describe("renderDocument --as markdown", () => {
  it("maps headings, title, and subtitle to hashes", () => {
    const md = renderDocument(
      doc([
        para(["Meeting notes\n"], { style: "TITLE" }),
        para(["Agenda\n"], { style: "HEADING_1" }),
        para(["Details\n"], { style: "HEADING_3" }),
      ]),
      "markdown",
    );
    expect(md).toBe("# Meeting notes\n# Agenda\n### Details");
  });

  it("maps bold, italic, and links", () => {
    const md = renderDocument(
      doc([
        para([
          "plain ",
          { text: "bold", bold: true },
          " and ",
          { text: "italic", italic: true },
          " and ",
          { text: "a link", url: "https://x.test" },
          "\n",
        ]),
      ]),
      "markdown",
    );
    expect(md).toBe("plain **bold** and *italic* and [a link](https://x.test)");
  });

  it("keeps surrounding spaces outside emphasis markers", () => {
    const md = renderDocument(doc([para([{ text: "bold ", bold: true }, "next\n"])]), "markdown");
    expect(md).toBe("**bold** next");
  });

  it("renders bulleted and numbered lists with nesting", () => {
    const md = renderDocument(
      doc(
        [
          para(["first\n"], { bullet: { listId: "L1" } }),
          para(["nested\n"], { bullet: { listId: "L1", nestingLevel: 1 } }),
          para(["step\n"], { bullet: { listId: "L2" } }),
        ],
        {
          lists: {
            L1: {
              listProperties: { nestingLevels: [{ glyphType: "GLYPH_TYPE_UNSPECIFIED" }, {}] },
            },
            L2: { listProperties: { nestingLevels: [{ glyphType: "DECIMAL" }] } },
          },
        },
      ),
      "markdown",
    );
    expect(md).toBe("- first\n  - nested\n1. step");
  });

  it("recognizes numbered lists from glyphFormat and bullets from glyphSymbol", () => {
    const md = renderDocument(
      doc(
        [
          para(["numbered\n"], { bullet: { listId: "F" } }),
          para(["bulleted\n"], { bullet: { listId: "S" } }),
          para(["unknown\n"], { bullet: { listId: "U" } }),
        ],
        {
          lists: {
            F: { listProperties: { nestingLevels: [{ glyphFormat: "%0." }] } },
            S: { listProperties: { nestingLevels: [{ glyphSymbol: "\u25cf" }] } },
            // Docs reports this for HTML-converted lists: no usable glyph info.
            U: { listProperties: { nestingLevels: [{ glyphType: "GLYPH_TYPE_UNSPECIFIED" }] } },
          },
        },
      ),
      "markdown",
    );
    expect(md).toBe("1. numbered\n- bulleted\n- unknown");
  });

  /**
   * Decision 0023 §5. Printing `1.` for every item hid the bug that record
   * fixes, and made a list that continues across other content look identical
   * to twelve separate lists.
   */
  describe("numbered items carry their real ordinal (0023 §5)", () => {
    const numbered = (start?: number) => ({
      lists: {
        L1: {
          listProperties: {
            nestingLevels: [
              { glyphType: "DECIMAL", ...(start === undefined ? {} : { startNumber: start }) },
              { glyphType: "DECIMAL" },
            ],
          },
        },
      },
    });

    it("counts through content interleaved between the items", () => {
      const md = renderDocument(
        doc(
          [
            para(["one\n"], { bullet: { listId: "L1" } }),
            para(["body\n"]),
            para(["two\n"], { bullet: { listId: "L1" } }),
            para(["three\n"], { bullet: { listId: "L1" } }),
          ],
          numbered(),
        ),
        "markdown",
      );
      expect(md).toBe("1. one\nbody\n2. two\n3. three");
    });

    it("starts where the list says it starts", () => {
      const md = renderDocument(
        doc(
          [
            para(["five\n"], { bullet: { listId: "L1" } }),
            para(["six\n"], { bullet: { listId: "L1" } }),
          ],
          numbered(5),
        ),
        "markdown",
      );
      expect(md).toBe("5. five\n6. six");
    });

    it("treats a start of 0 as 1, as the API says it does", () => {
      const md = renderDocument(
        doc([para(["zero\n"], { bullet: { listId: "L1" } })], numbered(0)),
        "markdown",
      );
      expect(md).toBe("1. zero");
    });

    it("counts each nesting level on its own, restarting a deeper one", () => {
      const md = renderDocument(
        doc(
          [
            para(["outer\n"], { bullet: { listId: "L1" } }),
            para(["inner\n"], { bullet: { listId: "L1", nestingLevel: 1 } }),
            para(["inner\n"], { bullet: { listId: "L1", nestingLevel: 1 } }),
            para(["outer\n"], { bullet: { listId: "L1" } }),
            para(["inner\n"], { bullet: { listId: "L1", nestingLevel: 1 } }),
          ],
          numbered(),
        ),
        "markdown",
      );
      expect(md).toBe("1. outer\n  1. inner\n  2. inner\n2. outer\n  1. inner");
    });

    it("counts two lists separately", () => {
      const md = renderDocument(
        doc(
          [
            para(["a\n"], { bullet: { listId: "L1" } }),
            para(["b\n"], { bullet: { listId: "L2" } }),
            para(["c\n"], { bullet: { listId: "L1" } }),
          ],
          {
            lists: {
              L1: { listProperties: { nestingLevels: [{ glyphType: "DECIMAL" }] } },
              L2: { listProperties: { nestingLevels: [{ glyphType: "DECIMAL" }] } },
            },
          },
        ),
        "markdown",
      );
      expect(md).toBe("1. a\n1. b\n2. c");
    });

    it("leaves bulleted items alone", () => {
      const md = renderDocument(
        doc([para(["x\n"], { bullet: { listId: "L1" } })], {
          lists: { L1: { listProperties: { nestingLevels: [{ glyphSymbol: "●" }] } } },
        }),
        "markdown",
      );
      expect(md).toBe("- x");
    });
  });

  /**
   * Decision 0024. Docs uses U+000B for a line break inside a paragraph — what
   * Shift+Enter makes — and it reached the output as a raw control character.
   */
  describe("a soft line break becomes a hard break (0024 §1)", () => {
    /** U+000B, written by code point so it is not an invisible byte here. */
    const VT = String.fromCharCode(11);

    it("spells a break with a backslash, keeping one paragraph", () => {
      expect(renderDocument(doc([para([`a${VT}b\n`])]), "markdown")).toBe("a\\\nb");
    });

    it("renders every break in a paragraph", () => {
      expect(renderDocument(doc([para([`a${VT}b${VT}c\n`])]), "markdown")).toBe("a\\\nb\\\nc");
    });

    it("renders a break in a heading and in a list item", () => {
      const md = renderDocument(
        doc(
          [
            para([`a${VT}b\n`], { style: "HEADING_2" }),
            para([`c${VT}d\n`], { bullet: { listId: "L1" } }),
          ],
          {
            lists: { L1: { listProperties: { nestingLevels: [{ glyphSymbol: "●" }] } } },
          },
        ),
        "markdown",
      );
      expect(md).toBe("## a\\\nb\n- c\\\nd");
    });

    it("drops trailing spaces, which would otherwise read as a break of their own", () => {
      expect(renderDocument(doc([para(["a  \n"])]), "markdown")).toBe("a");
    });

    it("leaves a paragraph without a break byte for byte", () => {
      expect(renderDocument(doc([para(["plain text\n"])]), "markdown")).toBe("plain text");
    });

    it("gives plain text a real newline rather than the control character", () => {
      expect(renderDocument(doc([para([`a${VT}b\n`])]), "text")).toBe("a\nb");
    });
  });

  it("renders tables as pipe rows with a header separator", () => {
    const table: StructuralElementRaw = {
      table: {
        tableRows: [
          { tableCells: [{ content: [para(["name\n"])] }, { content: [para(["score\n"])] }] },
          { tableCells: [{ content: [para(["alice\n"])] }, { content: [para(["90\n"])] }] },
        ],
      },
    };
    expect(renderDocument(doc([table]), "markdown")).toBe(
      "| name | score |\n| --- | --- |\n| alice | 90 |",
    );
  });

  it("preserves blank paragraphs and returns empty for an empty body", () => {
    expect(renderDocument(doc([para(["a\n"]), para(["\n"]), para(["b\n"])]), "markdown")).toBe(
      "a\n\nb",
    );
    expect(renderDocument(doc([]), "markdown")).toBe("");
  });
});

describe("renderDocument --as text", () => {
  it("drops styling and keeps paragraph text", () => {
    const text = renderDocument(
      doc([
        para(["Agenda\n"], { style: "HEADING_1" }),
        para([{ text: "bold", bold: true }, " tail\n"]),
        para(["item\n"], { bullet: { listId: "L1" } }),
      ]),
      "text",
    );
    expect(text).toBe("Agenda\nbold tail\nitem");
  });
});

describe("endOfBody", () => {
  it("returns the last element end index minus the trailing newline", () => {
    expect(endOfBody(doc([{ ...para(["hello\n"]), startIndex: 1, endIndex: 7 }]))).toBe(6);
  });

  it("returns 1 for an empty body", () => {
    expect(endOfBody(doc([]))).toBe(1);
  });
});

describe("Docs API wrappers", () => {
  it("getDocument fetches by id and maps errors", async () => {
    const get = vi.fn(async () => ({ data: doc([], { title: "T" }) }));
    expect((await getDocument(mockDocs({ get }), "D1")).title).toBe("T");
    expect(get).toHaveBeenCalledWith({ documentId: "D1" });

    const boom = vi.fn(async () => {
      throw Object.assign(new Error("gone"), { code: 404 });
    });
    await expect(getDocument(mockDocs({ get: boom }), "D1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("createDocument sends the title and returns id + title", async () => {
    const create = vi.fn(async () => ({ data: doc([], { documentId: "NEW", title: "Plan" }) }));
    const created = await createDocument(mockDocs({ create }), "Plan");
    expect(create).toHaveBeenCalledWith({ requestBody: { title: "Plan" } });
    expect(created).toEqual({ id: "NEW", title: "Plan" });
  });

  it("insertText issues an insertText request at the index", async () => {
    const batchUpdate = vi.fn(async () => ({ data: {} }));
    await insertText(mockDocs({ batchUpdate }), "D1", 5, "hi");
    expect(batchUpdate).toHaveBeenCalledWith({
      documentId: "D1",
      requestBody: { requests: [{ insertText: { location: { index: 5 }, text: "hi" } }] },
    });
  });

  it("replaceAllText returns the occurrence count and honors matchCase", async () => {
    const batchUpdate = vi.fn(async () => ({
      data: { replies: [{ replaceAllText: { occurrencesChanged: 3 } }] },
    }));
    const count = await replaceAllText(mockDocs({ batchUpdate }), "D1", "old", "new", true);
    expect(count).toBe(3);
    expect(batchUpdate).toHaveBeenCalledWith({
      documentId: "D1",
      requestBody: {
        requests: [
          {
            replaceAllText: {
              containsText: { text: "old", matchCase: true },
              replaceText: "new",
            },
          },
        ],
      },
    });
  });

  it("replaceAllText reports zero when the API omits the count", async () => {
    const batchUpdate = vi.fn(async () => ({ data: { replies: [{}] } }));
    expect(await replaceAllText(mockDocs({ batchUpdate }), "D1", "x", "y", false)).toBe(0);
  });
});

describe("insertMarkdown", () => {
  it("writes a table-free payload in a single batchUpdate", async () => {
    const client = mockDocs();
    const notes = await insertMarkdown(client, "D1", 1, "# Title\nbody");

    expect(client.documents.get).not.toHaveBeenCalled();
    const [call] = callArgs(vi.mocked(client.documents.batchUpdate));
    expect(call.requestBody.requests[0]).toEqual({
      insertText: { location: { index: 1 }, text: "Title\nbody\n" },
    });
    expect(notes).toEqual([]);
  });

  it("re-reads the document to fill a table's cells", async () => {
    const filled: DocumentRaw = {
      body: {
        content: [
          {
            startIndex: 1,
            table: {
              tableRows: [
                {
                  tableCells: [{ content: [{ startIndex: 4 }] }, { content: [{ startIndex: 6 }] }],
                },
              ],
            },
          },
        ],
      },
    };
    const client = mockDocs({ get: vi.fn(async () => ({ data: filled })) });
    await insertMarkdown(client, "D1", 1, "| a | b |\n| --- | --- |");

    expect(client.documents.get).toHaveBeenCalledTimes(1);
    const batches = vi.mocked(client.documents.batchUpdate).mock.calls;
    expect(batches).toHaveLength(2);
    expect(callArgs(vi.mocked(client.documents.batchUpdate), 0)[0].requestBody.requests).toEqual([
      { insertTable: { location: { index: 1 }, rows: 1, columns: 2 } },
    ]);
    expect(callArgs(vi.mocked(client.documents.batchUpdate), 1)[0].requestBody.requests).toEqual([
      { insertText: { location: { index: 6 }, text: "b" } },
      { insertText: { location: { index: 4 }, text: "a" } },
    ]);
  });

  it("starts a new paragraph when asked", async () => {
    const client = mockDocs();
    await insertMarkdown(client, "D1", 9, "tail", { leadingNewline: true });
    const requests = callArgs(vi.mocked(client.documents.batchUpdate))[0].requestBody.requests;
    expect(requests[0]).toEqual({ insertText: { location: { index: 9 }, text: "\ntail\n" } });
  });

  it("writes the text after a table past the table's real end", async () => {
    const filled: DocumentRaw = {
      body: {
        content: [
          {
            startIndex: 1,
            endIndex: 9,
            table: { tableRows: [{ tableCells: [{ content: [{ startIndex: 4 }] }] }] },
          },
        ],
      },
    };
    const client = mockDocs({ get: vi.fn(async () => ({ data: filled })) });
    await insertMarkdown(client, "D1", 1, "| a |\n| --- |\n\nafter");

    const last = vi.mocked(client.documents.batchUpdate).mock.calls.at(-1)?.[0];
    // the table ended at 9 and one character went into its cell
    expect(last?.requestBody.requests).toEqual([
      { insertText: { location: { index: 10 }, text: "after\n" } },
    ]);
  });

  it("reports what Docs cannot hold", async () => {
    const notes = await insertMarkdown(mockDocs(), "D1", 1, "text\n![alt](x.png)");
    expect(notes).toEqual([{ line: 2, kind: "image" }]);
  });
});

describe("findMarkerRanges", () => {
  const marked = (): DocumentRaw =>
    doc([
      { startIndex: 1, ...para(["before ", "MARK", " after\n"]) },
      {
        startIndex: 20,
        table: { tableRows: [{ tableCells: [{ content: [{ ...para(["MARK\n"]) }] }] }] },
      },
    ]);

  it("finds a marker that spans runs and reports its Docs range", () => {
    expect(findMarkerRanges(marked(), "MARK", true)).toEqual([{ startIndex: 8, endIndex: 12 }]);
  });

  it("matches case-insensitively unless asked not to", () => {
    expect(findMarkerRanges(marked(), "mark", false)).toHaveLength(1);
    expect(findMarkerRanges(marked(), "mark", true)).toEqual([]);
  });

  it("does not match inside a table, which cannot hold the replacement", () => {
    const ranges = findMarkerRanges(marked(), "MARK", true);
    expect(ranges.every((r) => r.startIndex < 20)).toBe(true);
  });
});

describe("replaceMarkdown", () => {
  it("edits occurrences last to first, so no earlier edit moves a later one", async () => {
    const document: DocumentRaw = doc([
      { startIndex: 1, ...para(["X here\n"]) },
      { startIndex: 8, ...para(["and X again\n"]) },
    ]);
    const client = mockDocs({ get: vi.fn(async () => ({ data: document })) });

    const { replaced } = await replaceMarkdown(client, "D1", "X", "**new**", true);

    expect(replaced).toBe(2);
    const deletes = vi
      .mocked(client.documents.batchUpdate)
      .mock.calls.flatMap((call) => call[0].requestBody.requests)
      .filter((request) => "deleteContentRange" in request);
    expect(deletes).toEqual([
      { deleteContentRange: { range: { startIndex: 12, endIndex: 13 } } },
      { deleteContentRange: { range: { startIndex: 1, endIndex: 2 } } },
    ]);
  });

  it("reports zero without touching the document when the marker is absent", async () => {
    const client = mockDocs({ get: vi.fn(async () => ({ data: doc([para(["nothing\n"])]) })) });
    const { replaced } = await replaceMarkdown(client, "D1", "MARK", "x", true);
    expect(replaced).toBe(0);
    expect(client.documents.batchUpdate).not.toHaveBeenCalled();
  });
});
