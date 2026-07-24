import { describe, expect, it } from "vitest";
import { looksLikeId, resolvePath, ROOT_ID } from "./resolve-path.ts";
import { AppError } from "../types/index.ts";
import { createTreeDrive, type DriveNode } from "../../tests/helpers/fake-drive.ts";

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
    const err = (await resolvePath(drive, "Reports").catch((e) => e)) as AppError;
    expect(err.message).toContain("rep1");
    expect(err.message).toContain("rep2");
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
