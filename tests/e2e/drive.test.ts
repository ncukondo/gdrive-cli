import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import {
  describeLive,
  file,
  gdrive,
  gdriveAs,
  gdriveError,
  info,
  list,
  LIVE_TIMEOUT,
  useSandbox,
  type DriveFile,
} from "./helpers/sandbox.ts";

/**
 * What Drive says a file *is*, and what survives a write.
 *
 * The type vocabulary is the half of task 0034 a fake cannot check: a form read
 * as `type: file` for as long as the map said so, and every unit test agreed,
 * because every unit test was told what the map says.
 */

const listingSchema = z.object({
  files: z.array(z.object({ id: z.string() })),
  complete: z.boolean(),
});

const JAPANESE_NAME = "研修医へのフィードバックシート";

describeLive("Drive against a real account", () => {
  const sandbox = useSandbox();
  let local = "";
  let seeded: DriveFile[] = [];

  beforeAll(async () => {
    local = mkdtempSync(join(tmpdir(), "gdrive-e2e-"));
    const upload = join(local, "payload.bin");
    writeFileSync(upload, "e2e payload\n");

    await gdrive("mkdir", "child-folder", "--parent", sandbox.id);
    await gdrive("docs", "create", "A document", "--parent", sandbox.id);
    await gdrive("sheets", "create", "A spreadsheet", "--parent", sandbox.id);
    await gdrive("upload", upload, "--parent", sandbox.id, "--name", JAPANESE_NAME);

    seeded = await list(sandbox.id);
  }, LIVE_TIMEOUT);

  afterAll(() => {
    if (local !== "") rmSync(local, { recursive: true, force: true });
  });

  it(
    "labels each seeded file with the type the CLI can act on",
    () => {
      const byName = new Map(seeded.map((entry) => [entry.name, entry.type]));
      expect(byName.get("child-folder")).toBe("folder");
      expect(byName.get("A document")).toBe("doc");
      expect(byName.get("A spreadsheet")).toBe("sheet");
      expect(byName.get(JAPANESE_NAME)).toBe("file");
    },
    LIVE_TIMEOUT,
  );

  /**
   * Issue #32's reachable half. `complete` is what a caller reads to know the
   * listing is all of one, and the value is decided from Drive's own
   * `nextPageToken` — so this is the assertion a fake cannot make, even though
   * it only ever exercises the true branch.
   *
   * The false branch would need 100,001 files in one folder. It is asserted
   * against a fake in `src/lib/api.test.ts` and `src/lib/copy-tree.test.ts`,
   * and saying so here is better than a case that quietly proves half of what
   * its name claims.
   */
  it(
    "says an ordinary listing is complete, from Drive's own pagination",
    async () => {
      const listing = await gdriveAs(listingSchema, "ls", sandbox.id);
      expect(listing.complete).toBe(true);
      expect(listing.files.length).toBe(seeded.length);
    },
    LIVE_TIMEOUT,
  );

  it(
    "reports only types the file object documents",
    () => {
      const vocabulary = ["folder", "doc", "sheet", "slides", "form", "shortcut", "file"];
      for (const entry of seeded) expect(vocabulary).toContain(entry.type);
    },
    LIVE_TIMEOUT,
  );

  it(
    "filters to exactly the document with --type doc",
    async () => {
      const docs = await list(sandbox.id, "--type", "doc");
      expect(docs.map((entry) => entry.name)).toEqual(["A document"]);
    },
    LIVE_TIMEOUT,
  );

  it(
    "gives every file a link and no shortcut target",
    async () => {
      for (const entry of seeded) {
        const detail = await info(entry.id);
        expect(detail.web_view_link).toMatch(/^https:\/\//);
        expect(detail.target_id).toBeNull();
        expect(detail.target_type).toBeNull();
      }
    },
    LIVE_TIMEOUT,
  );

  it(
    "copies, moves and trashes, and each is confirmed by reading it back",
    async () => {
      const target = await file("mkdir", "write-target", "--parent", sandbox.id);
      const source = seeded.find((entry) => entry.name === JAPANESE_NAME);
      if (source === undefined) throw new Error("the uploaded file is missing");

      const copy = await file("cp", source.id, target.id, "--name", "a copy");
      expect((await info(copy.id)).name).toBe("a copy");
      expect((await list(target.id)).map((entry) => entry.name)).toEqual(["a copy"]);

      await gdrive("mv", copy.id, sandbox.id);
      expect(await list(target.id)).toEqual([]);

      await gdrive("rm", copy.id);
      expect((await info(copy.id)).trashed).toBe(true);

      const remaining = (await list(sandbox.id)).map((entry) => entry.name);
      expect(remaining).not.toContain("a copy");
      expect(remaining).toEqual(
        expect.arrayContaining(["A document", "A spreadsheet", "child-folder", JAPANESE_NAME]),
      );
    },
    LIVE_TIMEOUT,
  );

  it(
    "answers NOT_FOUND for a file it really deleted",
    async () => {
      const doomed = await file("mkdir", "permanently-gone", "--parent", sandbox.id);
      await gdrive("rm", doomed.id, "--permanent");
      expect(await gdriveError("info", doomed.id)).toBe("NOT_FOUND");
    },
    LIVE_TIMEOUT,
  );
});
