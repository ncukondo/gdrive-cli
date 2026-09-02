import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  describeLive,
  gdrive,
  gdriveAs,
  gdriveError,
  LIVE_TIMEOUT,
  useSandbox,
} from "./helpers/sandbox.ts";
import { google } from "googleapis";
import { nodeFs } from "../../src/lib/fs.ts";
import { loadConfig } from "../../src/lib/config.ts";
import { getAccountClient } from "../../src/lib/account.ts";

/**
 * The one place these tests reach past the CLI binary, and the generated
 * googleapis client rather than this project's port.
 *
 * Both are deliberate. Nothing in this CLI sends `createHeader`, so a document
 * with a header cannot be built from the surface under test; and the port's
 * request union does not name that request, correctly — adding it so a fixture
 * could be built would grow the guarded surface for a test's convenience. The
 * case is worth reaching for: the manual version of it found three defects no
 * fake could raise.
 */
async function docsClient() {
  const { client } = await getAccountClient(nodeFs, loadConfig(nodeFs), undefined);
  return google.docs({ version: "v1", auth: client });
}

const createdSchema = z.object({ id: z.string() });
const bodySchema = z.object({ content: z.string() });

/**
 * Markdown in, Markdown out, through a real document.
 *
 * This is the part of the CLI a fake has been least able to help with. All
 * three defects task 0023 fixed were index arithmetic against the Docs API, and
 * 0025 and 0026 each found another; every one of them was invisible to a test
 * that asserts the request array, because the request array was what the author
 * believed Docs wanted.
 */

const SOURCE = [
  "# E2E round trip",
  "",
  "| head | value |",
  "| ---- | ----- |",
  "| alpha | 1 |",
  "| beta | 2 |",
  "",
  "3. third",
  "4. fourth",
  "",
  "- outer",
  "    - inner",
  "",
  "An autolink: <https://example.com>",
  "",
  "A bare one: https://example.org/bare",
  "",
  "soft break here\\",
  "and the line after it",
  "",
  "<!-- marker -->",
  "",
].join("\n");

describeLive("Docs against a real account", () => {
  const sandbox = useSandbox();
  let local = "";
  let documentId = "";
  let readBack = "";

  beforeAll(async () => {
    local = mkdtempSync(join(tmpdir(), "gdrive-e2e-docs-"));
    const source = join(local, "source.md");
    writeFileSync(source, SOURCE);

    documentId = (
      await gdriveAs(
        createdSchema,
        "docs",
        "create",
        "Round trip",
        "--content",
        `@${source}`,
        "--parent",
        sandbox.id,
      )
    ).id;
    readBack = (await gdriveAs(bodySchema, "docs", "read", documentId)).content;
  }, LIVE_TIMEOUT);

  afterAll(() => {
    if (local !== "") rmSync(local, { recursive: true, force: true });
  });

  it(
    "keeps the heading a heading",
    () => {
      expect(readBack).toMatch(/^# E2E round trip$/m);
    },
    LIVE_TIMEOUT,
  );

  it(
    "brings the table back as a table, not as a line of pipes",
    () => {
      const rows = readBack.split("\n").filter((line) => line.includes("alpha"));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatch(/\|\s*alpha\s*\|\s*1\s*\|/);
      expect(readBack).toMatch(/\|\s*beta\s*\|\s*2\s*\|/);
    },
    LIVE_TIMEOUT,
  );

  it(
    "keeps an ordered list's starting number",
    () => {
      expect(readBack).toMatch(/^3\. third$/m);
      expect(readBack).toMatch(/^4\. fourth$/m);
    },
    LIVE_TIMEOUT,
  );

  it(
    "keeps a nested item nested",
    () => {
      const inner = readBack.split("\n").find((line) => line.includes("inner"));
      expect(inner).toBeDefined();
      expect(inner).toMatch(/^\s+[-*] inner$/);
    },
    LIVE_TIMEOUT,
  );

  it(
    "links an autolink and a bare URL",
    () => {
      expect(readBack).toMatch(/\]\(https:\/\/example\.com\)|<https:\/\/example\.com>/);
      expect(readBack).toMatch(/\]\(https:\/\/example\.org\/bare\)|<https:\/\/example\.org\/bare>/);
    },
    LIVE_TIMEOUT,
  );

  it(
    "round-trips a soft line break as a hard break",
    () => {
      expect(readBack).toMatch(/soft break here\\\nand the line after it/);
    },
    LIVE_TIMEOUT,
  );

  it(
    "inserts in front of a marker and leaves the document readable",
    async () => {
      await gdrive("docs", "insert", documentId, "Scheduled.", "--before", "<!-- marker -->");
      const after = (await gdriveAs(bodySchema, "docs", "read", documentId)).content;

      expect(after).toContain("Scheduled.");
      expect(after.indexOf("Scheduled.")).toBeLessThan(after.indexOf("<!-- marker -->"));
      expect(after).toMatch(/^# E2E round trip$/m);
      expect(after).toMatch(/\|\s*alpha\s*\|\s*1\s*\|/);
    },
    LIVE_TIMEOUT,
  );

  /**
   * Decision 0045 §4. Docs decides what an insert inherits, so a fake can only
   * confirm that the requests undoing it were sent. Whether they work is here.
   *
   * Every write below lands somewhere that used to change how it looked: after
   * a heading, in front of a bulleted item, at the head of a heading, and
   * immediately after a bold run. Font, size and colour are invisible to `read`
   * and stay a manual check.
   */
  describe("what a write leaves behind is the document's default style", () => {
    const STYLED = [
      "- first item",
      "- second item",
      "",
      "**strong**",
      "",
      "# Trailing heading",
      "",
    ].join("\n");
    let styled = "";
    let after = "";

    beforeAll(async () => {
      styled = (
        await gdriveAs(
          createdSchema,
          "docs",
          "create",
          "Style drag",
          "--content",
          STYLED,
          "--parent",
          sandbox.id,
        )
      ).id;

      // Each of these lands on a style that used to spread into it.
      await gdrive("docs", "append", styled, "appended body");
      await gdrive("docs", "insert", styled, "inserted line", "--before", "second item");
      await gdrive("docs", "insert", styled, "tail", "--after", "strong");
      await gdrive(
        "docs",
        "insert",
        styled,
        "literal insert\n",
        "--before",
        "Trailing heading",
        "--as",
        "text",
      );
      await gdrive("docs", "insert", styled, "joined", "--after", "first item", "--as", "text");
      // A CRLF payload: Docs drops each CR, so a range measured against what we
      // handed it would reach two characters into the bold run below.
      await gdrive(
        "docs",
        "insert",
        styled,
        "one\r\ntwo\r\n",
        "--before",
        "strong",
        "--as",
        "text",
      );
      after = (await gdriveAs(bodySchema, "docs", "read", styled)).content;
    }, LIVE_TIMEOUT);

    /**
     * This one cannot fail, and says so rather than looking like cover.
     *
     * A document this CLI builds always ends in the empty `NORMAL_TEXT`
     * paragraph `documents.create` gave it — every Markdown write inserts
     * before it — so `append` splits a paragraph that never had a style to
     * spread. The case where it does is a document written in the Docs UI,
     * which the suite cannot author. That is a manual check (0043 §4), and
     * task 0040 names it; what is left here is a smoke test that the append
     * still lands as its own body paragraph.
     */
    it(
      "appends body text as a paragraph of its own",
      () => {
        expect(after).toMatch(/^appended body$/m);
      },
      LIVE_TIMEOUT,
    );

    it(
      "inserts an ordinary paragraph in front of a bulleted item",
      () => {
        expect(after).toMatch(/^inserted line$/m);
        expect(after).toMatch(/^- second item$/m);
      },
      LIVE_TIMEOUT,
    );

    it(
      "writes plain characters straight after bold ones",
      () => {
        expect(after).toMatch(/\*\*strong\*\*tail/);
      },
      LIVE_TIMEOUT,
    );

    it(
      "gives --as text the same default style, not the heading it landed on",
      () => {
        expect(after).toMatch(/^literal insert$/m);
        expect(after).toMatch(/^# Trailing heading$/m);
      },
      LIVE_TIMEOUT,
    );

    it(
      "measures a CRLF payload as Docs stores it, leaving the run below it alone",
      () => {
        expect(after).toMatch(/^one$/m);
        expect(after).toMatch(/^two$/m);
        // Two characters short and the reset would have eaten "st" out of it.
        expect(after).toMatch(/\*\*strong\*\*tail/);
      },
      LIVE_TIMEOUT,
    );

    it(
      "leaves the style of a paragraph it only joined — 0045 §2's one exception",
      () => {
        // "joined" went inside the first bullet, which stays a bullet: a
        // paragraph cannot be half a list item, and it was not ours to restyle.
        expect(after).toMatch(/^- first itemjoined$/m);
      },
      LIVE_TIMEOUT,
    );
  });

  /**
   * Issue #21, decision 0064.
   *
   * Nothing in this CLI creates a header, a footer or a footnote, so the
   * fixture is built through the Docs client directly — the one place these
   * tests reach past the binary, and they do it because the case cannot exist
   * otherwise. It earns that: the manual version of this pass found three
   * defects no fake could raise, two of which only appear together.
   */
  describe("headers, footers and footnotes (issue #21, decision 0064)", () => {
    let segmented = "";
    let headerId = "";

    beforeAll(async () => {
      const made = await gdriveAs(
        createdSchema,
        "docs",
        "create",
        "segments",
        "--content",
        "BODY LINE\n",
        "--parent",
        sandbox.id,
      );
      segmented = made.id;
      const docs = await docsClient();
      await docs.documents.batchUpdate({
        documentId: segmented,
        requestBody: {
          requests: [
            { createHeader: { type: "DEFAULT" } },
            { createFootnote: { location: { index: 1 } } },
          ],
        },
      });
      const raw = (await docs.documents.get({ documentId: segmented })).data;
      headerId = Object.keys(raw.headers ?? {})[0] ?? "";
      const footnoteId = Object.keys(raw.footnotes ?? {})[0] ?? "";
      await docs.documents.batchUpdate({
        documentId: segmented,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: 0, segmentId: headerId },
                text: "first line\nBETA second\n",
              },
            },
            {
              insertText: { location: { index: 0, segmentId: footnoteId }, text: "FNSTART note\n" },
            },
          ],
        },
      });
    }, LIVE_TIMEOUT);

    it(
      "reads all three beside the body",
      async () => {
        const content = (await gdriveAs(bodySchema, "docs", "read", segmented)).content;
        expect(content).toContain("BODY LINE");
        expect(content).toContain(`<!-- header: ${headerId} -->`);
        expect(content).toContain("BETA second");
        expect(content).toContain("FNSTART note");
      },
      LIVE_TIMEOUT,
    );

    /**
     * The case the manual pass caught twice over. `--before` a marker that
     * opens a paragraph is where the API refuses `pageBreakBefore` outside the
     * body — and where an absent `startIndex` has to read as 0 for the reset to
     * be planned at all. Either fix alone leaves this red or silently wrong.
     */
    it(
      "writes into the header, not the body",
      async () => {
        await gdrive("docs", "insert", segmented, "NEW", "--before", "BETA");
        const content = (await gdriveAs(bodySchema, "docs", "read", segmented)).content;
        expect(content).toMatch(/NEW\s*\n?BETA second/);
        // The body is untouched, which is what the first version of this got
        // wrong: the registrar dropped the segment and wrote here instead.
        expect(content).toMatch(/^BODY LINE$/m);
      },
      LIVE_TIMEOUT,
    );

    /** Docs holds tables, but not in a footnote (decision 0064, Consequences). */
    it(
      "reports a table it cannot put in a footnote, and writes the rest",
      async () => {
        const table = join(local, "fn-table.md");
        writeFileSync(table, "| a | b |\n| - | - |\n| 1 | 2 |\n");
        await gdrive("docs", "insert", segmented, `@${table}`, "--after", "FNSTART");
        const content = (await gdriveAs(bodySchema, "docs", "read", segmented)).content;
        expect(content).toContain("FNSTART note");
      },
      LIVE_TIMEOUT,
    );

    it(
      "refuses a marker that is in the body and in the header",
      async () => {
        const docs = await docsClient();
        await docs.documents.batchUpdate({
          documentId: segmented,
          requestBody: {
            requests: [
              { insertText: { location: { index: 1, segmentId: headerId }, text: "BODY LINE" } },
            ],
          },
        });
        // The code, because that is what the helper reports; the count is in
        // the message and is asserted where messages are, beside the resolver.
        // What matters live is that Google was never asked: the alternative to
        // this refusal is a write landing in a segment nobody named.
        expect(await gdriveError("docs", "insert", segmented, "X", "--before", "BODY LINE")).toBe(
          "INVALID_ARGS",
        );
        const after = (await gdriveAs(bodySchema, "docs", "read", segmented)).content;
        expect(after).not.toContain("X");
      },
      LIVE_TIMEOUT,
    );
  });

  /**
   * The compatibility guarantee, which is the thing most likely to regress: a
   * document with no segments must read exactly as it did before the walk
   * learned about them.
   */
  it(
    "reads a document with no header or footnote exactly as it did before",
    async () => {
      const plain = (await gdriveAs(bodySchema, "docs", "read", documentId)).content;
      expect(plain).not.toContain("<!-- header:");
      expect(plain).not.toContain("<!-- footer:");
      expect(plain).not.toContain("<!-- footnote:");
      expect(plain).toMatch(/^# E2E round trip$/m);
    },
    LIVE_TIMEOUT,
  );

  /**
   * Issue #41, and the shape it was reported in: a Markdown draft containing a
   * pipe table was inserted, and nothing could take it back out. The table is
   * what makes this live rather than a fake's business — `deleteContentRange`
   * over a range that spans a real Docs table is a request only Docs can accept
   * or refuse, and no fake knows which.
   *
   * The blank-line assertion is the other half. `replace --replace ""` leaves
   * the paragraph mark, which is what made the report's workaround useless;
   * whether the mark really goes is something the round trip can see.
   *
   * **The draft goes in the middle, and the comparison is exact.** The first
   * version of this put it at the end and compared with `trimEnd()`, and it
   * passed with decision 0062 §3's paragraph rule removed — a leftover blank
   * paragraph at the end of a document is trimmed by the very call that was
   * meant to ignore whitespace. Measured, mid-document and untrimmed, the
   * difference is `"AAA before.\nTAIL ANCHOR"` against
   * `"AAA before.\n\nTAIL ANCHOR"`.
   */
  describe("undoing an insert (issue #41, decision 0062)", () => {
    let undone = "";
    let before = "";

    beforeAll(async () => {
      const created = await gdriveAs(
        createdSchema,
        "docs",
        "create",
        "undo me",
        "--content",
        "# Kept\n\nThis paragraph must survive.\n\nTAIL ANCHOR\n",
        "--parent",
        sandbox.id,
      );
      before = (await gdriveAs(bodySchema, "docs", "read", created.id)).content;
      await gdrive(
        "docs",
        "insert",
        created.id,
        ["DRAFT OPENS", "", "| a | b |", "| - | - |", "| 1 | 2 |", "", "DRAFT CLOSES"].join("\n"),
        "--before",
        "TAIL ANCHOR",
      );
      const filled = (await gdriveAs(bodySchema, "docs", "read", created.id)).content;
      expect(filled).toContain("DRAFT OPENS");
      expect(filled).toMatch(/\|\s*1\s*\|\s*2\s*\|/);

      await gdrive("docs", "delete", created.id, "--from", "DRAFT OPENS", "--to", "DRAFT CLOSES");
      undone = (await gdriveAs(bodySchema, "docs", "read", created.id)).content;
    }, LIVE_TIMEOUT);

    it(
      "removes a range that spans a real Docs table",
      () => {
        expect(undone).not.toContain("DRAFT OPENS");
        expect(undone).not.toContain("DRAFT CLOSES");
        expect(undone).not.toMatch(/\|\s*1\s*\|/);
      },
      LIVE_TIMEOUT,
    );

    it(
      "leaves the document as it was, without the blank paragraphs a replace would",
      () => {
        // Not just "the text is gone": the report's complaint was 35 empty
        // paragraphs where 35 lines used to be. Exact, with no trimming — the
        // blank paragraph this is about is between two lines, and trimming is
        // what let an earlier version of this test pass without the fix.
        expect(undone).toBe(before);
      },
      LIVE_TIMEOUT,
    );
  });
});
