import { describe, expect, it, vi } from "vitest";
import { looksLikeId, resolvePath, resolveTarget, ROOT_ID } from "./resolve-path.ts";
import type { DriveClient } from "./api.ts";
import { createTreeDrive, type DriveNode } from "../../tests/helpers/fake-drive.ts";
import { callArgs } from "../../tests/helpers/mock.ts";

const FOLDER = "application/vnd.google-apps.folder";

// root/
//   Reports/         (rep1)
//     2026/          (y2026)  -> summary (sum1)
//   Reports/         (rep2)   duplicate name (ambiguous)
//   Notes            (note1)
const tree: DriveNode[] = [
  { id: "rep1", name: "Reports", mimeType: FOLDER, parents: [ROOT_ID] },
  { id: "rep2", name: "Reports", mimeType: FOLDER, parents: [ROOT_ID] },
  { id: "note1", name: "Notes", parents: [ROOT_ID] },
  { id: "y2026", name: "2026", mimeType: FOLDER, parents: ["rep1"] },
  { id: "sum1", name: "summary", parents: ["y2026"] },
];

describe("looksLikeId", () => {
  it("accepts long slash-free id-like strings", () => {
    expect(looksLikeId("1AbCdEfGhIjKlMnOpQrStUv")).toBe(true);
  });
  it("rejects short names and paths", () => {
    expect(looksLikeId("Reports")).toBe(false);
    expect(looksLikeId("Reports/2026")).toBe(false);
    expect(looksLikeId("My Folder")).toBe(false);
  });
  it("accepts a 19-character shared drive root id (decision 0016)", () => {
    // `info` prints these in `parents`, so they have to be re-addressable.
    expect("0ANPgzMZtaAa6Uk9PVA").toHaveLength(19);
    expect(looksLikeId("0ANPgzMZtaAa6Uk9PVA")).toBe(true);
  });
  it("still rejects a 19-character name that is not a drive root", () => {
    expect("Reports-Archive-201").toHaveLength(19);
    expect(looksLikeId("Reports-Archive-201")).toBe(false);
  });
});

describe("resolvePath", () => {
  it("returns root for empty, '/', and 'root'", async () => {
    const drive = createTreeDrive(tree);
    expect(await resolvePath(drive, "")).toBe(ROOT_ID);
    expect(await resolvePath(drive, "/")).toBe(ROOT_ID);
    expect(await resolvePath(drive, "root")).toBe(ROOT_ID);
  });

  it("passes an ID-looking argument through unchanged", async () => {
    const id = "1AbCdEfGhIjKlMnOpQrStUvWx";
    expect(await resolvePath(createTreeDrive(tree), id)).toBe(id);
  });

  it("walks a nested unambiguous path to the leaf id", async () => {
    // Reports (unique under root only if we remove the duplicate); use a clean tree.
    const clean: DriveNode[] = [
      { id: "rep1", name: "Reports", mimeType: FOLDER, parents: [ROOT_ID] },
      { id: "y2026", name: "2026", mimeType: FOLDER, parents: ["rep1"] },
      { id: "sum1", name: "summary", parents: ["y2026"] },
    ];
    expect(await resolvePath(createTreeDrive(clean), "Reports/2026/summary")).toBe("sum1");
  });

  it("resolves a single-segment folder name", async () => {
    expect(await resolvePath(createTreeDrive(tree), "Notes")).toBe("note1");
  });

  it("errors INVALID_ARGS on an ambiguous segment, listing candidates", async () => {
    const drive = createTreeDrive(tree);
    await expect(resolvePath(drive, "Reports")).rejects.toMatchObject({ code: "INVALID_ARGS" });
    await expect(resolvePath(drive, "Reports")).rejects.toThrow(/rep1/);
    await expect(resolvePath(drive, "Reports")).rejects.toThrow(/rep2/);
  });

  it("declares shared-drive support on its lookup query (decision 0016)", async () => {
    const tree_ = createTreeDrive(tree);
    const list = vi.fn(tree_.files.list);
    const spied: DriveClient = { ...tree_, files: { ...tree_.files, list } };
    await resolvePath(spied, "Notes");
    expect(callArgs(list)[0]).toMatchObject({ supportsAllDrives: true });
  });

  it("errors NOT_FOUND when a segment does not resolve", async () => {
    const clean: DriveNode[] = [
      { id: "rep1", name: "Reports", mimeType: FOLDER, parents: [ROOT_ID] },
    ];
    await expect(resolvePath(createTreeDrive(clean), "Reports/missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("issues no drives.list for a plain My Drive path", async () => {
    // The tree fake's drives.list throws, so a stray lookup fails the test.
    expect(await resolvePath(createTreeDrive(tree), "Notes")).toBe("note1");
  });
});

// A shared drive `Finance` (root FIN) holding 2026/Budget, plus a My Drive
// folder of the same name, which is the ambiguity `drive:` exists to resolve.
const driveTree: DriveNode[] = [
  { id: "myfin", name: "Finance", mimeType: FOLDER, parents: [ROOT_ID] },
  { id: "y2026", name: "2026", mimeType: FOLDER, parents: ["FIN"] },
  { id: "bud1", name: "Budget", parents: ["y2026"] },
];
const drives = [{ id: "FIN", name: "Finance" }];

describe("resolvePath with a drive: prefix (decision 0019)", () => {
  it("resolves a bare drive name to its root id without listing files", async () => {
    const fake = createTreeDrive(driveTree, drives);
    const list = vi.fn(fake.files.list);
    const spied: DriveClient = { ...fake, files: { ...fake.files, list } };
    expect(await resolvePath(spied, "drive:Finance")).toBe("FIN");
    expect(list).not.toHaveBeenCalled();
  });

  it("walks segments from the drive root, not from My Drive", async () => {
    const fake = createTreeDrive(driveTree, drives);
    const list = vi.fn(fake.files.list);
    const spied: DriveClient = { ...fake, files: { ...fake.files, list } };
    expect(await resolvePath(spied, "drive:Finance/2026/Budget")).toBe("bud1");
    expect(callArgs(list)[0].q).toContain("'FIN' in parents");
  });

  it("keeps a same-named My Drive folder reachable without the prefix", async () => {
    expect(await resolvePath(createTreeDrive(driveTree, drives), "Finance")).toBe("myfin");
  });

  it("includes shared-drive items in the lookup query", async () => {
    const fake = createTreeDrive(driveTree, drives);
    const list = vi.fn(fake.files.list);
    const spied: DriveClient = { ...fake, files: { ...fake.files, list } };
    await resolvePath(spied, "drive:Finance/2026");
    expect(callArgs(list)[0]).toMatchObject({
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
  });

  it("reports an unknown drive name as NOT_FOUND, listing what exists", async () => {
    await expect(
      resolvePath(createTreeDrive(driveTree, drives), "drive:Nope/x"),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: expect.stringContaining("Finance"),
    });
  });

  it("reports a duplicated drive name as INVALID_ARGS listing the ids", async () => {
    const dupes = [
      { id: "FIN", name: "Finance" },
      { id: "FIN2", name: "Finance" },
    ];
    await expect(
      resolvePath(createTreeDrive(driveTree, dupes), "drive:Finance"),
    ).rejects.toMatchObject({
      code: "INVALID_ARGS",
      message: expect.stringContaining("FIN2"),
    });
  });

  it.each([["drive:"], ["drive:/2026"]])("rejects %s, which names no drive", async (arg) => {
    await expect(resolvePath(createTreeDrive(driveTree, drives), arg)).rejects.toMatchObject({
      code: "INVALID_ARGS",
    });
  });
});

// root/
//   Reports/                  (rep1)
//     2026/                   (y2026)  -> summary (sum1), link-to-archive (lnk3)
//     archive/                (arch1)  -> old (old1)
//     link-to-2026  ->  2026            (lnk1)
//     Notes                   (doc1, a Doc)
//     link-to-notes ->  Notes           (lnk2)
const DOC = "application/vnd.google-apps.document";
const shortcutTree: DriveNode[] = [
  { id: "rep1", name: "Reports", mimeType: FOLDER, parents: [ROOT_ID] },
  { id: "y2026", name: "2026", mimeType: FOLDER, parents: ["rep1"] },
  { id: "sum1", name: "summary", parents: ["y2026"] },
  { id: "arch1", name: "archive", mimeType: FOLDER, parents: ["rep1"] },
  { id: "old1", name: "old", parents: ["arch1"] },
  { id: "lnk1", name: "link-to-2026", parents: ["rep1"], target: "y2026" },
  { id: "lnk3", name: "link-to-archive", parents: ["y2026"], target: "arch1" },
  { id: "doc1", name: "Notes", mimeType: DOC, parents: ["rep1"] },
  { id: "lnk2", name: "link-to-notes", parents: ["rep1"], target: "doc1" },
];

describe("resolvePath through a shortcut (decision 0025 §1)", () => {
  it("walks into the target of an intermediate folder shortcut", async () => {
    const drive = createTreeDrive(shortcutTree);
    expect(await resolvePath(drive, "Reports/link-to-2026/summary")).toBe("sum1");
  });

  it("follows one on a drive: path too", async () => {
    const onShared: DriveNode[] = [
      { id: "y2026", name: "2026", mimeType: FOLDER, parents: ["FIN"] },
      { id: "bud1", name: "Budget", parents: ["y2026"] },
      { id: "lnk1", name: "link-to-2026", parents: ["FIN"], target: "y2026" },
    ];
    expect(
      await resolvePath(createTreeDrive(onShared, drives), "drive:Finance/link-to-2026/Budget"),
    ).toBe("bud1");
  });

  it("follows two shortcuts that are separate segments", async () => {
    const drive = createTreeDrive(shortcutTree);
    expect(await resolvePath(drive, "Reports/link-to-2026/link-to-archive/old")).toBe("old1");
  });

  it("leaves a terminal shortcut unfollowed — that is `resolveTarget`'s job", async () => {
    const drive = createTreeDrive(shortcutTree);
    expect(await resolvePath(drive, "Reports/link-to-2026")).toBe("lnk1");
    expect(await resolvePath(drive, "Reports/link-to-notes")).toBe("lnk2");
  });

  it("still reports NOT_FOUND past a shortcut to a Doc, naming that segment", async () => {
    // Decision 0025 §6: no new branch — the next `'<id>' in parents` is empty.
    await expect(
      resolvePath(createTreeDrive(shortcutTree), "Reports/link-to-notes/page"),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "No such file or folder: Reports/link-to-notes/page",
    });
  });
});

const SHORTCUT = "application/vnd.google-apps.shortcut";
const LINK_ID = "1LnkAaaaaaaaaaaaaaaaaaaa";
const DOC_ID = "1DocAaaaaaaaaaaaaaaaaaaa";

// The same shapes addressed by ID rather than by name.
const byIdTree: DriveNode[] = [
  { id: DOC_ID, name: "Notes", mimeType: DOC, parents: [ROOT_ID] },
  { id: LINK_ID, name: "link-to-notes", parents: [ROOT_ID], target: DOC_ID },
];

function spyOnGet(drive: DriveClient) {
  const get = vi.fn(drive.files.get);
  const client: DriveClient = { ...drive, files: { ...drive.files, get } };
  return { client, get };
}

describe("resolveTarget (decision 0025 §3)", () => {
  it("follows a path that names a shortcut, and pays nothing for the walk", async () => {
    const { client, get } = spyOnGet(createTreeDrive(shortcutTree));
    const { id } = await resolveTarget(client, "Reports/link-to-notes");
    expect(id).toBe("doc1");
    // One `files.get`: the target, which is also what checks it still exists.
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("returns an ordinary file's own id, unfollowed and unfetched", async () => {
    const { client, get } = spyOnGet(createTreeDrive(shortcutTree));
    expect(await resolveTarget(client, "Reports/Notes")).toEqual({ id: "doc1", file: null });
    expect(get).not.toHaveBeenCalled();
  });

  it("costs one files.get for a bare id, and hands the metadata back", async () => {
    const { client, get } = spyOnGet(createTreeDrive(byIdTree));
    const resolved = await resolveTarget(client, DOC_ID);
    expect(resolved.id).toBe(DOC_ID);
    expect(resolved.file).toMatchObject({ id: DOC_ID, name: "Notes", type: "doc" });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("follows a bare id that turns out to be a shortcut", async () => {
    const resolved = await resolveTarget(createTreeDrive(byIdTree), LINK_ID);
    expect(resolved.id).toBe(DOC_ID);
    // The metadata describes the id that came back, so a caller that needs it
    // (`download`) does not fetch it again.
    expect(resolved.file).toMatchObject({ id: DOC_ID, type: "doc" });
  });

  it("leaves resolvePath on the same argument pointing at the shortcut", async () => {
    const drive = createTreeDrive(byIdTree);
    expect(await resolvePath(drive, LINK_ID)).toBe(LINK_ID);
    expect(await resolvePath(createTreeDrive(shortcutTree), "Reports/link-to-notes")).toBe("lnk2");
  });

  it("asks Drive for nothing when the argument is a root", async () => {
    const { client, get } = spyOnGet(createTreeDrive(shortcutTree));
    expect(await resolveTarget(client, "/")).toEqual({ id: ROOT_ID, file: null });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("resolveTarget on a shortcut it cannot follow (decision 0025 §5, §6)", () => {
  it("names the argument, and the word shortcut, when the target is gone", async () => {
    const dangling: DriveNode[] = [
      { id: "rep1", name: "Reports", mimeType: FOLDER, parents: [ROOT_ID] },
      { id: "lnk1", name: "link", parents: ["rep1"], target: "deleted-target" },
    ];
    await expect(resolveTarget(createTreeDrive(dangling), "Reports/link")).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: expect.stringContaining('Shortcut "Reports/link"'),
    });
    await expect(resolveTarget(createTreeDrive(dangling), "Reports/link")).rejects.toThrow(
      /deleted-target/,
    );
  });

  it("treats a trashed target as gone", async () => {
    const trashedTarget: DriveNode[] = [
      { id: "doc1", name: "Notes", mimeType: DOC, parents: [ROOT_ID], trashed: true },
      { id: "lnk1", name: "link", parents: [ROOT_ID], target: "doc1" },
    ];
    await expect(resolveTarget(createTreeDrive(trashedTarget), "link")).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: expect.stringContaining("Shortcut"),
    });
  });

  it("reports a shortcut with no target as API_ERROR, not NOT_FOUND", async () => {
    // Drive answering its own MIME with no `shortcutDetails.targetId` breaks
    // its own contract, which is an API_ERROR (0020 §4 takes the same line).
    const malformed: DriveNode[] = [
      { id: LINK_ID, name: "link", mimeType: SHORTCUT, parents: [ROOT_ID] },
    ];
    await expect(resolveTarget(createTreeDrive(malformed), "link")).rejects.toMatchObject({
      code: "API_ERROR",
    });
    await expect(resolveTarget(createTreeDrive(malformed), LINK_ID)).rejects.toMatchObject({
      code: "API_ERROR",
    });
  });

  it("refuses a chain rather than hopping twice", async () => {
    const chained: DriveNode[] = [
      { id: "doc1", name: "Notes", mimeType: DOC, parents: [ROOT_ID] },
      { id: "lnk1", name: "inner", parents: [ROOT_ID], target: "doc1" },
      { id: "lnk2", name: "outer", parents: [ROOT_ID], target: "lnk1" },
    ];
    await expect(resolveTarget(createTreeDrive(chained), "outer")).rejects.toMatchObject({
      code: "API_ERROR",
    });
  });
});

describe("resolvePath's shared-drive hint", () => {
  it("points at the drive: form when the first segment names a shared drive", async () => {
    // No My Drive folder called Finance here — just the shared drive.
    const onlyShared: DriveNode[] = [{ id: "y2026", name: "2026", parents: ["FIN"] }];
    await expect(
      resolvePath(createTreeDrive(onlyShared, drives), "Finance/2026"),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: expect.stringContaining("drive:Finance/2026"),
    });
  });

  it("suggests a form that actually works, even from a leading slash", async () => {
    const onlyShared: DriveNode[] = [{ id: "y2026", name: "2026", parents: ["FIN"] }];
    const message = await resolvePath(createTreeDrive(onlyShared, drives), "/Finance/2026").catch(
      (e: Error) => e.message,
    );
    // "drive:/Finance/2026" would be INVALID_ARGS: the drive name reads empty.
    expect(message).toContain('"drive:Finance/2026"');
    expect(await resolvePath(createTreeDrive(onlyShared, drives), "drive:Finance/2026")).toBe(
      "y2026",
    );
  });

  it("stays quiet when no shared drive has that name", async () => {
    const message = await resolvePath(createTreeDrive(tree, drives), "Missing/x").catch(
      (e: Error) => e.message,
    );
    expect(message).toBe("No such file or folder: Missing");
  });

  it("hints only on the first segment", async () => {
    const clean: DriveNode[] = [
      { id: "rep1", name: "Reports", mimeType: FOLDER, parents: [ROOT_ID] },
    ];
    const message = await resolvePath(createTreeDrive(clean, drives), "Reports/Finance").catch(
      (e: Error) => e.message,
    );
    expect(message).toBe("No such file or folder: Reports/Finance");
  });

  it("keeps the original NOT_FOUND when the drive lookup itself fails", async () => {
    // The tree fake without a drives array throws from drives.list.
    await expect(resolvePath(createTreeDrive(tree), "Missing/x")).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "No such file or folder: Missing",
    });
  });
});
