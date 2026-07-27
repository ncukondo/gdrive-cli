import { describe, expect, it, vi } from "vitest";
import { looksLikeId, resolvePath, ROOT_ID } from "./resolve-path.ts";
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
});
