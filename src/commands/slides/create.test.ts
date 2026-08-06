import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../types/index.ts";
import {
  slideDocumentToYaml,
  type PageElementRaw,
  type PageRaw,
  type PresentationRaw,
  type SlideDocument,
} from "../../lib/slide-document.ts";
import type { SlidesRequest } from "../../lib/slides-api.ts";
import { handleSlidesCreate, type SlidesCreateDeps } from "./create.ts";
import { childrenNamed, ROOT_ID } from "../../lib/resolve-path.ts";
import { createWritableTreeDrive, type DriveNode } from "../../../tests/helpers/fake-drive.ts";
import { UNPATHABLE_ANYWHERE, UNPATHABLE_AT_A_DRIVE_ROOT } from "../../../tests/helpers/names.ts";

function collect() {
  const lines: string[] = [];
  return {
    write: (m: string) => lines.push(m),
    get output() {
      return lines.join("\n");
    },
  };
}

function layoutPlaceholder(objectId: string, type: string): PageElementRaw {
  return { objectId, shape: { placeholder: { type, index: 0 }, text: { textElements: [] } } };
}

const layouts: PageRaw[] = [
  {
    objectId: "L_TB",
    layoutProperties: { name: "TITLE_AND_BODY" },
    pageElements: [layoutPlaceholder("l_t", "TITLE"), layoutPlaceholder("l_b", "BODY")],
  },
  { objectId: "L_BLANK", layoutProperties: { name: "BLANK" }, pageElements: [] },
];

/** What `presentations.create` hands back: a title, a theme, and one slide. */
const fresh: PresentationRaw = {
  presentationId: "1NeWdEcK",
  title: "Q4 review",
  layouts,
  slides: [{ objectId: "p", slideProperties: { layoutObjectId: "L_TB" } }],
};

const document: SlideDocument = {
  title: "Whatever the document called itself",
  slides: [
    { layout: "TITLE_AND_BODY", title: "The quarter in one slide", body: "Revenue up 12%" },
    { layout: "BLANK" },
  ],
};

interface Run {
  output: string;
  warnings: string[];
  batches: { presentationId: string; requests: SlidesRequest[] }[];
  moves: { id: string; parentId: string }[];
  /** The order the calls went out in, which is what issue #36 is about. */
  calls: string[];
  error?: unknown;
}

async function run(options: Partial<SlidesCreateDeps> = {}): Promise<Run> {
  const out = collect();
  const warnings: string[] = [];
  const batches: Run["batches"] = [];
  const moves: Run["moves"] = [];
  const calls: string[] = [];

  const deps: SlidesCreateDeps = {
    resolvePath: async () => "1FoLdEr",
    createPresentation: async (title) => ({ ...fresh, title }),
    getPresentation: async () => fresh,
    batchUpdate: async (presentationId, requests) => {
      batches.push({ presentationId, requests });
    },
    moveFile: async (id, parentId) => {
      moves.push({ id, parentId });
    },
    findSiblings: async () => [],
    readInput: async () => slideDocumentToYaml(document),
    title: "Q4 review",
    format: "json",
    quiet: false,
    write: out.write,
    warn: (m) => warnings.push(m),
    ...options,
  };

  // Wrapped after the overrides, so a case that supplies its own
  // `createPresentation` or `batchUpdate` is recorded like the default one.
  // Each name is logged once the call *returns*, so `calls` reads as what
  // reached Slides and Drive before whatever failed.
  const logged: SlidesCreateDeps = {
    ...deps,
    createPresentation: async (title) => {
      const created = await deps.createPresentation(title);
      calls.push("create");
      return created;
    },
    getPresentation: async (presentationId) => {
      const read = await deps.getPresentation(presentationId);
      calls.push("read back");
      return read;
    },
    batchUpdate: async (presentationId, requests) => {
      await deps.batchUpdate(presentationId, requests);
      calls.push("fill");
    },
    moveFile: async (presentationId, parentId) => {
      const moved = await deps.moveFile(presentationId, parentId);
      calls.push("move");
      return moved;
    },
  };

  try {
    await handleSlidesCreate(logged);
  } catch (error) {
    return { output: out.output, warnings, batches, moves, calls, error };
  }
  return { output: out.output, warnings, batches, moves, calls };
}

const codeOf = (error: unknown): string =>
  error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;

describe("handleSlidesCreate (decision 0030 §4)", () => {
  it("creates an empty deck with the title and touches nothing else", async () => {
    const createPresentation = vi.fn(async (title: string) => ({ ...fresh, title }));
    const result = await run({ createPresentation });
    expect(createPresentation).toHaveBeenCalledWith("Q4 review");
    // Slides' default slide is what a caller gets, as `docs create` gives an
    // empty document — so there is no batch at all.
    expect(result.batches).toEqual([]);
    expect(JSON.parse(result.output).data).toMatchObject({
      id: "1NeWdEcK",
      title: "Q4 review",
    });
  });

  it("removes the default slide and builds the document's, in one batch", async () => {
    const result = await run({ source: "deck.yaml" });
    expect(result.batches).toHaveLength(1);
    const requests = result.batches[0]?.requests ?? [];
    // The default slide goes first, so the deck ends as exactly the document.
    expect(requests[0]).toEqual({ deleteObject: { objectId: "p" } });
    expect(requests.filter((request) => "createSlide" in request)).toHaveLength(2);
    expect(requests).toContainEqual({
      insertText: {
        objectId: "gdrive_title_1",
        insertionIndex: 0,
        text: "The quarter in one slide",
      },
    });
  });

  it("takes the title from the argument, not from the document", async () => {
    const result = await run({ source: "deck.yaml", title: "Q4 review" });
    expect(JSON.parse(result.output).data.title).toBe("Q4 review");
    // Nothing tries to rename the deck to what the document called itself.
    expect(JSON.parse(result.output).data.unsupported).toBeUndefined();
  });

  it("moves the deck afterwards and reports where it went", async () => {
    const result = await run({ source: "deck.yaml", parent: "Decks" });
    expect(result.moves).toEqual([{ id: "1NeWdEcK", parentId: "1FoLdEr" }]);
    expect(JSON.parse(result.output).data.parent_id).toBe("1FoLdEr");
  });

  /**
   * Issue #36. The deck exists before its layouts can be matched against the
   * document, so the two failures below — a batch the API refuses, and a layout
   * this deck's theme does not have — both arrive with a deck already made.
   * Moving first is what decides whether it is in the folder the caller named or
   * loose in My Drive's root, outside the sandbox the live suite writes inside
   * (0043 §2).
   */
  it("moves the deck into --parent before it builds the document's slides", async () => {
    const result = await run({ parent: "Decks", source: "deck.yaml" });
    expect(result.calls).toEqual(["create", "move", "fill"]);
  });

  it("moves the deck before reading it back for its layouts", async () => {
    const bare: PresentationRaw = {
      presentationId: "1NeWdEcK",
      title: "Q4 review",
      slides: [{ objectId: "p", slideProperties: { layoutObjectId: "L_TB" } }],
    };
    const result = await run({
      parent: "Decks",
      source: "deck.yaml",
      createPresentation: async () => bare,
    });
    expect(result.calls).toEqual(["create", "move", "read back", "fill"]);
  });

  /**
   * The deck exists and holds Slides' own first slide, and the caller never saw
   * a success envelope naming it — so the failure names it (decision 0031 §4).
   */
  it("leaves a deck naming an unknown layout inside --parent, and names it", async () => {
    const unknown: SlideDocument = { title: "x", slides: [{ layout: "NO_SUCH_LAYOUT" }] };
    const result = await run({
      parent: "Decks",
      source: "deck.yaml",
      readInput: async () => slideDocumentToYaml(unknown),
    });
    expect(codeOf(result.error)).toBe("INVALID_ARGS");
    expect(result.error).toMatchObject({
      data: {
        payload: { id: "1NeWdEcK", title: "Q4 review", parent_id: "1FoLdEr" },
        quiet: "1NeWdEcK",
      },
    });
    expect(result.moves).toEqual([{ id: "1NeWdEcK", parentId: "1FoLdEr" }]);
    expect(result.calls).toEqual(["create", "move"]);
  });

  it("issues no move at all without --parent", async () => {
    const result = await run({ source: "deck.yaml" });
    expect(result.calls).toEqual(["create", "fill"]);
  });

  it("prints the new presentation id in quiet mode, and a sentence in text mode", async () => {
    expect((await run({ format: "text", quiet: true })).output).toBe("1NeWdEcK");
    expect((await run({ format: "text" })).output).toBe("Created Q4 review (1NeWdEcK)");
  });

  it("reads the deck back when create returned no layouts, so text has somewhere to go", async () => {
    const getPresentation = vi.fn(async () => fresh);
    const bare: PresentationRaw = {
      presentationId: "1NeWdEcK",
      title: "Q4 review",
      slides: [{ objectId: "p", slideProperties: { layoutObjectId: "L_TB" } }],
    };
    const result = await run({
      source: "deck.yaml",
      createPresentation: async () => bare,
      getPresentation,
    });
    expect(getPresentation).toHaveBeenCalledWith("1NeWdEcK");
    expect(result.batches[0]?.requests).toContainEqual({
      insertText: {
        objectId: "gdrive_title_1",
        insertionIndex: 0,
        text: "The quarter in one slide",
      },
    });
  });

  it("does not read the deck back when create already returned its layouts", async () => {
    const getPresentation = vi.fn(async () => fresh);
    await run({ source: "deck.yaml", getPresentation });
    expect(getPresentation).not.toHaveBeenCalled();
  });

  it("leaves no empty deck behind when the document does not parse", async () => {
    const createPresentation = vi.fn(async (title: string) => ({ ...fresh, title }));
    const result = await run({
      source: "deck.yaml",
      readInput: async () => "- not a mapping\n",
      createPresentation,
    });
    expect(codeOf(result.error)).toBe("INVALID_ARGS");
    expect(createPresentation).not.toHaveBeenCalled();
  });

  it("reports what a copy could not carry, rather than failing it", async () => {
    const withElements: SlideDocument = {
      ...document,
      slides: [
        {
          layout: "BLANK",
          notes: "Say this",
          elements: [{ id: "x1", kind: "shape", text: "A box someone dragged on" }],
        },
      ],
    };
    const result = await run({
      source: "deck.yaml",
      readInput: async () => slideDocumentToYaml(withElements),
    });
    expect(JSON.parse(result.output).data.unsupported).toEqual([
      { index: 0, title: "", kind: "notes" },
      { index: 0, title: "", kind: "elements" },
    ]);
    expect(result.batches).toHaveLength(1);
  });
  /**
   * Decision 0055 §1-§2. The title is the Drive name, so the same `create` run
   * twice is the collision - and §2 puts the check ahead of
   * `presentations.create`, because a refusal afterwards leaves a deck the
   * caller has to go and delete.
   */
  describe("a title that would not address the new deck", () => {
    const siblings = (nodes: DriveNode[]) => {
      const { client } = createWritableTreeDrive(nodes);
      return (parentId: string, name: string) => childrenNamed(client, parentId, name);
    };

    it("refuses a title --parent already holds, and creates nothing", async () => {
      const createPresentation = vi.fn(async (title: string) => ({ ...fresh, title }));
      const result = await run({
        parent: "Decks",
        source: "@deck.yaml",
        createPresentation,
        findSiblings: siblings([{ id: "E1", name: "Q4 review", parents: ["1FoLdEr"] }]),
      });
      expect(codeOf(result.error)).toBe("INVALID_ARGS");
      expect(String(result.error)).toContain("E1");
      expect(createPresentation).not.toHaveBeenCalled();
      expect(result.batches).toEqual([]);
      expect(result.moves).toEqual([]);
    });

    it("refuses a title the My Drive root already holds", async () => {
      const createPresentation = vi.fn(async (title: string) => ({ ...fresh, title }));
      const result = await run({
        createPresentation,
        findSiblings: siblings([{ id: "E1", name: "Q4 review", parents: [ROOT_ID] }]),
      });
      expect(codeOf(result.error)).toBe("INVALID_ARGS");
      expect(createPresentation).not.toHaveBeenCalled();
    });

    it.each(UNPATHABLE_ANYWHERE)(
      "refuses %j wherever it would land, without asking Drive anything",
      async (title) => {
        for (const parent of [undefined, "Decks"]) {
          const createPresentation = vi.fn(async (t: string) => ({ ...fresh, title: t }));
          const findSiblings = vi.fn(async () => []);
          const result = await run({
            title,
            createPresentation,
            findSiblings,
            ...(parent === undefined ? {} : { parent }),
          });
          expect(codeOf(result.error)).toBe("INVALID_ARGS");
          expect(findSiblings).not.toHaveBeenCalled();
          expect(createPresentation).not.toHaveBeenCalled();
        }
      },
    );

    it.each(UNPATHABLE_AT_A_DRIVE_ROOT)(
      "refuses %j with no --parent, where the title is the whole path argument",
      async (title) => {
        const createPresentation = vi.fn(async (t: string) => ({ ...fresh, title: t }));
        const findSiblings = vi.fn(async () => []);
        const result = await run({ title, createPresentation, findSiblings });
        expect(codeOf(result.error)).toBe("INVALID_ARGS");
        expect(findSiblings).not.toHaveBeenCalled();
        expect(createPresentation).not.toHaveBeenCalled();
      },
    );

    /** Decision 0056 §2's other half: below a root every one of them works. */
    it.each(UNPATHABLE_AT_A_DRIVE_ROOT)("creates %j inside --parent", async (title) => {
      const createPresentation = vi.fn(async (t: string) => ({ ...fresh, title: t }));
      const result = await run({ title, createPresentation, parent: "Decks" });
      expect(result.error).toBeUndefined();
      expect(createPresentation).toHaveBeenCalledWith(title);
    });
  });
});
