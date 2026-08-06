import { beforeAll, expect, it } from "vitest";
import { z } from "zod";
import {
  describeLive,
  file,
  gdrive,
  gdriveAs,
  info,
  list,
  LIVE_TIMEOUT,
  useSandbox,
} from "./helpers/sandbox.ts";

/**
 * What a shortcut *is*, as Drive answers rather than as a MIME map believes.
 *
 * `target_id` and `target_type` are Drive's `shortcutDetails`, and the `Link`
 * a shortcut carries is built by Drive from the shortcut's own id. Both were
 * task 0034's subject and neither could be settled by a fake: a form read as
 * `type: file` for as long as the map said so, and 0027 declined to print a
 * link at all because nobody knew which of the two ids Drive puts in it.
 *
 * Every case below names the role decision 0025 §1 gives its argument —
 * **container** ("look inside this"), **content** ("read what is in this") or
 * **entry** ("this file, as an entry in a folder") — because that table is the
 * whole rule and each of the three is a different call against Drive.
 *
 * **The path form of the walk is not here, and cannot be.** `resolvePath`
 * walks from My Drive's root, so naming a file in this sandbox by path names
 * every folder above the sandbox as well — and 0043 §2 forbids a test that
 * addresses anything outside it. That is a permanent consequence of the two
 * rules together rather than a gap for somebody to close later: no fixture,
 * no helper and no choice of anchor makes a path rooted at My Drive stay
 * inside a subtree of it. Following a shortcut **by id** runs the same
 * `resolveTarget` hop and is what the cases below do; following one as an
 * *intermediate path segment* stays with the manual pass for good (0043 §4).
 */

const documentSchema = z.object({ id: z.string(), title: z.string(), content: z.string() });
const createdSchema = z.object({ id: z.string() });

const BODY = "the target document's own body";

describeLive("Shortcuts against a real account", () => {
  const sandbox = useSandbox();
  let targetDocument = "";
  let targetFolder = "";
  let documentLink = "";
  let folderLink = "";

  beforeAll(async () => {
    targetDocument = (
      await gdriveAs(
        createdSchema,
        "docs",
        "create",
        "the document a shortcut points at",
        "--content",
        BODY,
        "--parent",
        sandbox.id,
      )
    ).id;

    targetFolder = (await file("mkdir", "the folder a shortcut points at", "--parent", sandbox.id))
      .id;
    await gdrive("mkdir", "the only child of that folder", "--parent", targetFolder);

    documentLink = (await file("ln", targetDocument, sandbox.id, "--name", "link to the document"))
      .id;
    folderLink = (await file("ln", targetFolder, sandbox.id, "--name", "link to the folder")).id;
  }, LIVE_TIMEOUT);

  it(
    "reports a shortcut as one, and names what it points at",
    async () => {
      const entry = (await list(sandbox.id)).find((child) => child.id === documentLink);
      expect(entry?.type).toBe("shortcut");
      expect(entry?.target_id).toBe(targetDocument);
      // The type of the *target*, which comes from `shortcutDetails
      // .targetMimeType` and from nowhere else. Task 0034's defect was a map
      // that answered `file` here and a unit suite that agreed with it.
      expect(entry?.target_type).toBe("doc");
    },
    LIVE_TIMEOUT,
  );

  it(
    "reads the target's body through the shortcut — the content role",
    async () => {
      const read = await gdriveAs(documentSchema, "docs", "read", documentLink);
      expect(read.id).toBe(targetDocument);
      expect(read.content).toContain(BODY);
    },
    LIVE_TIMEOUT,
  );

  it(
    "lists the target folder's children through the shortcut — the container role",
    async () => {
      const children = await list(folderLink);
      expect(children.map((child) => child.name)).toEqual(["the only child of that folder"]);
    },
    LIVE_TIMEOUT,
  );

  it(
    "answers what the id is, which is the shortcut and not the target — the entry role",
    async () => {
      const detail = await info(documentLink);
      expect(detail.id).toBe(documentLink);
      expect(detail.type).toBe("shortcut");
      expect(detail.target_id).toBe(targetDocument);
      // Drive builds the link from the shortcut's own id, so `Link:` opens the
      // pointer and `Target:` is the way to the document. That is the fact
      // 0027 could not check and 0034 measured.
      expect(detail.web_view_link).toContain(documentLink);
      expect(detail.web_view_link).not.toContain(targetDocument);
    },
    LIVE_TIMEOUT,
  );

  it(
    "links what a shortcut points at, because Drive stores no shortcut to a shortcut",
    async () => {
      const second = await file(
        "ln",
        documentLink,
        sandbox.id,
        "--name",
        "second link to the document",
      );
      // Decision 0026 §2. Sending `documentLink` as the target is a request
      // Drive refuses outright, so this passing is Drive confirming the hop
      // happened before the create.
      expect(second.target_id).toBe(targetDocument);
      expect(second.target_type).toBe("doc");
    },
    LIVE_TIMEOUT,
  );

  it(
    "trashes the link and leaves the target alone",
    async () => {
      await gdrive("rm", documentLink);
      expect((await info(documentLink)).trashed).toBe(true);
      expect((await info(targetDocument)).trashed).toBe(false);
    },
    LIVE_TIMEOUT,
  );
});
