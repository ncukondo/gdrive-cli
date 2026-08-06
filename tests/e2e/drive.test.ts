import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

  /**
   * The two write paths whose defects were Drive's own defaults rather than
   * this CLI's arithmetic.
   *
   * A copy sent without a name is renamed by Drive, and *not uniformly*: a
   * Google-native document comes back as `Copy of <name>` while a binary file
   * beside it keeps its own. A fake answers whichever of the two its author had
   * in mind, and a tree copied under it is a tree half of whose files were
   * silently renamed. A rename is the mirror image: Drive carries the new name
   * into the in-document title, which is the only reason `rename` needs no
   * per-type behaviour, and nothing but Drive can confirm it.
   */
  describe("a tree survives a copy, and a rename reaches inside the file", () => {
    const documentSchema = z.object({ id: z.string(), title: z.string() });
    const entrySchema = z.object({ src: z.string(), dst: z.string(), name: z.string() });
    const reportSchema = z.object({
      file: z.looseObject({ id: z.string(), name: z.string() }),
      folders: z.array(entrySchema),
      copied: z.array(entrySchema),
    });

    const TREE = "the folder that gets copied";
    const SUBFOLDER = "a subfolder inside it";
    const TREE_DOC = "a document Drive would rename";
    const TREE_BINARY = "a binary Drive would not rename";
    const TREE_LINK = "a shortcut inside the tree";
    const LINK_TARGET = "the folder that shortcut points at";
    const LINK_TARGET_CHILD = "the one child of the shortcut's target";

    let source = "";
    let linkTarget = "";
    let destination = "";
    let report: z.infer<typeof reportSchema> = {
      file: { id: "", name: "" },
      folders: [],
      copied: [],
    };
    let copies: DriveFile[] = [];

    beforeAll(async () => {
      const upload = join(local, "tree-payload.bin");
      writeFileSync(upload, "a payload that survives a copy\n");

      linkTarget = (await file("mkdir", LINK_TARGET, "--parent", sandbox.id)).id;
      await gdrive("mkdir", LINK_TARGET_CHILD, "--parent", linkTarget);

      source = (await file("mkdir", TREE, "--parent", sandbox.id)).id;
      await gdrive("mkdir", SUBFOLDER, "--parent", source);
      await gdrive("docs", "create", TREE_DOC, "--parent", source);
      await gdrive("upload", upload, "--parent", source, "--name", TREE_BINARY);
      await gdrive("ln", linkTarget, source, "--name", TREE_LINK);

      destination = (await file("mkdir", "where the copy lands", "--parent", sandbox.id)).id;
      report = await gdriveAs(reportSchema, "cp", "-r", source, destination);
      copies = await list(report.file.id);
    }, LIVE_TIMEOUT);

    it(
      "gives every copy the name its source had, at every level",
      () => {
        // With no name in the request, the document below comes back as
        // "Copy of …" and the binary beside it does not, so a suite with one
        // file in the tree can pass either way. Both are here for that reason.
        expect(report.file.name).toBe(TREE);
        expect(copies.map((child) => child.name).sort()).toEqual(
          [SUBFOLDER, TREE_BINARY, TREE_DOC, TREE_LINK].sort(),
        );
        expect(report.copied.map((entry) => entry.name).sort()).toEqual(
          [TREE_BINARY, TREE_DOC, TREE_LINK].sort(),
        );
      },
      LIVE_TIMEOUT,
    );

    it(
      "copies a shortcut as a pointer, and does not copy what it points at",
      async () => {
        // Decision 0031 §2: the walk enumerates entries, and an entry never
        // follows (0025 §1). `files.copy` on a shortcut duplicates the pointer,
        // which is Drive's behaviour rather than this CLI's.
        const copiedLink = copies.find((child) => child.name === TREE_LINK);
        expect(copiedLink?.type).toBe("shortcut");
        expect(copiedLink?.target_id).toBe(linkTarget);

        expect(report.folders.map((entry) => entry.name)).toEqual([TREE, SUBFOLDER]);
        expect(copies.map((child) => child.name)).not.toContain(LINK_TARGET);
        // Nothing was copied *into* the target either.
        expect((await list(linkTarget)).map((child) => child.name)).toEqual([LINK_TARGET_CHILD]);
      },
      LIVE_TIMEOUT,
    );

    it(
      "refuses cp -r on every spelling of the root, and copies nothing",
      async () => {
        // `resolvePath` answers the literal alias `root` for all three, while a
        // `parents` list carries My Drive's real id — so the cycle guard used to
        // compare an alias with an id, find no match, and start copying My Drive
        // into a folder inside My Drive, where it kept finding the copy it had
        // just made. The guard resolves the alias now; this is what says so.
        const empty = await file("mkdir", "where nothing should land", "--parent", sandbox.id);
        for (const spelling of ["/", "root", ""]) {
          expect(await gdriveError("cp", "-r", spelling, empty.id)).toBe("INVALID_ARGS");
        }
        expect(await list(empty.id)).toEqual([]);
      },
      LIVE_TIMEOUT,
    );

    it(
      "moves a document's Drive name and its in-document title together",
      async () => {
        const document = await gdriveAs(
          documentSchema,
          "docs",
          "create",
          "the name before the rename",
          "--parent",
          sandbox.id,
        );
        await gdrive("rename", document.id, "the name after the rename");

        expect((await info(document.id)).name).toBe("the name after the rename");
        // The Docs API's own `title`, which is the in-document one. `rename`
        // sends a `files.update` and nothing else; that this reaches the
        // document is Drive's doing, and decision 0052's whole basis.
        const read = await gdriveAs(documentSchema, "docs", "read", document.id);
        expect(read.title).toBe("the name after the rename");
      },
      LIVE_TIMEOUT,
    );
  });
});
