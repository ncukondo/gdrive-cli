import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import { describeLive, gdrive, gdriveAs, LIVE_TIMEOUT, useSandbox } from "./helpers/sandbox.ts";

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
});
