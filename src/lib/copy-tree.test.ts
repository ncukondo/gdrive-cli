import { describe, expect, it, vi } from "vitest";
import { copyTree } from "./copy-tree.ts";
import { FOLDER_MIME, SHORTCUT_MIME } from "./api.ts";
import { AppError, type ErrorData } from "../types/index.ts";
import {
  createWritableTreeDrive,
  driveApiError,
  type DriveNode,
  type FakeCall,
} from "../../tests/helpers/fake-drive.ts";

/**
 * ```
 * DEST
 * 1F  2026/          <- the source
 *     1A  a.pdf
 *     1S  sub/
 *         1B  b.txt
 * ```
 */
function twoLevelTree(): DriveNode[] {
  return [
    { id: "DEST", name: "Archive", mimeType: FOLDER_MIME, parents: ["root"] },
    { id: "1F", name: "2026", mimeType: FOLDER_MIME, parents: ["root"] },
    { id: "1A", name: "a.pdf", mimeType: "application/pdf", parents: ["1F"] },
    { id: "1S", name: "sub", mimeType: FOLDER_MIME, parents: ["1F"] },
    { id: "1B", name: "b.txt", mimeType: "text/plain", parents: ["1S"] },
  ];
}

const source = { id: "1F", name: "2026" };

/** Backoff a test does not wait for (decision 0031 §5). */
const noWait = { baseDelayMs: 0, sleep: async () => {} };

/** The `data` a partial failure carries, or nothing when it carries none. */
function dataOf(error: unknown): ErrorData | undefined {
  return error instanceof AppError ? error.data : undefined;
}

function payloadOf(error: unknown): Record<string, unknown> {
  const payload = dataOf(error)?.payload;
  return typeof payload === "object" && payload !== null ? { ...payload } : {};
}

async function failureFrom(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error("expected the walk to fail");
}

describe("copyTree", () => {
  it("creates each folder before anything goes into it, and reports every id", async () => {
    const drive = createWritableTreeDrive(twoLevelTree());
    const report = await copyTree(drive.client, source, "DEST");

    // A folder exists before its contents, so whatever survives a stopped run
    // is a subtree rather than a scatter of parentless files (decision 0031 §2).
    expect(drive.trace()).toEqual([
      "create:DEST",
      "list:1F",
      "copy:1A",
      "create:new1",
      "list:1S",
      "copy:1B",
    ]);

    expect(report.folders).toEqual([
      { src: "1F", dst: "new1", name: "2026" },
      { src: "1S", dst: "new3", name: "sub" },
    ]);
    expect(report.copied).toEqual([
      { src: "1A", dst: "new2", name: "a.pdf" },
      { src: "1B", dst: "new4", name: "b.txt" },
    ]);
    expect(report.root).toMatchObject({ id: "new1", name: "2026", type: "folder" });

    // And the tree Drive is left holding is the one that was asked for.
    const under = (parent: string) =>
      drive.nodes.filter((n) => (n.parents ?? []).includes(parent)).map((n) => n.name);
    expect(under("DEST")).toEqual(["2026"]);
    expect(under("new1").sort()).toEqual(["a.pdf", "sub"]);
    expect(under("new3")).toEqual(["b.txt"]);
  });

  /**
   * Every copy names itself in the request, because Drive's default name is not
   * the source's — a live run had a nested Doc land as `Copy of TreeDoc` while
   * the binary file beside it kept its name. The request body is what is
   * asserted, not the resulting tree: the tree is only ever as truthful about
   * naming as the fake that built it, and it was the fake echoing the name back
   * that hid this in the first place.
   */
  it("names every copy in the request, rather than leaving it to Drive", async () => {
    const drive = createWritableTreeDrive(twoLevelTree());
    const copy = vi.fn(drive.client.files.copy);
    const client = { ...drive.client, files: { ...drive.client.files, copy } };

    const report = await copyTree(client, source, "DEST");

    expect(copy.mock.calls.map(([params]) => [params.fileId, params.requestBody.name])).toEqual([
      ["1A", "a.pdf"],
      ["1B", "b.txt"],
    ]);
    expect(report.copied.map((c) => c.name)).toEqual(["a.pdf", "b.txt"]);
  });

  it("copies an empty folder as an empty folder", async () => {
    const drive = createWritableTreeDrive([
      { id: "DEST", name: "Archive", mimeType: FOLDER_MIME },
      { id: "1F", name: "2026", mimeType: FOLDER_MIME },
    ]);
    const report = await copyTree(drive.client, source, "DEST");
    expect(drive.trace()).toEqual(["create:DEST", "list:1F"]);
    expect(report.copied).toEqual([]);
    expect(report.folders).toHaveLength(1);
  });

  it("renames only the top-level copy", async () => {
    const drive = createWritableTreeDrive(twoLevelTree());
    const report = await copyTree(drive.client, source, "DEST", { name: "2026 (archived)" });
    expect(report.root.name).toBe("2026 (archived)");
    expect(report.folders.map((f) => f.name)).toEqual(["2026 (archived)", "sub"]);
    expect(report.copied.map((f) => f.name)).toEqual(["a.pdf", "b.txt"]);
  });

  /**
   * Decision 0031 §2, which is decision 0025 §1's entry rule again: the walk
   * enumerates entries, and an entry never follows. Following one would copy a
   * folder the user did not name — possibly someone else's.
   */
  describe("a shortcut inside the tree", () => {
    const withShortcuts = (): DriveNode[] => [
      { id: "DEST", name: "Archive", mimeType: FOLDER_MIME },
      { id: "1F", name: "2026", mimeType: FOLDER_MIME },
      { id: "1L", name: "link-to-2025", parents: ["1F"], target: "1G" },
      { id: "1M", name: "link-to-doc", parents: ["1F"], target: "1D" },
      // Outside the source tree, and named by nothing the user typed.
      { id: "1G", name: "2025", mimeType: FOLDER_MIME },
      { id: "1H", name: "deep.pdf", mimeType: "application/pdf", parents: ["1G"] },
      { id: "1D", name: "notes", mimeType: "application/vnd.google-apps.document" },
    ];

    it("is copied as a shortcut, and its target is neither listed nor copied", async () => {
      const drive = createWritableTreeDrive(withShortcuts());
      const report = await copyTree(drive.client, source, "DEST");

      expect(drive.trace()).toEqual(["create:DEST", "list:1F", "copy:1L", "copy:1M"]);
      // Nothing under the folder the shortcut points at was touched.
      expect(drive.trace()).not.toContain("list:1G");
      expect(report.copied.map((c) => c.src)).toEqual(["1L", "1M"]);
      expect(report.copied.map((c) => c.name)).toEqual(["link-to-2025", "link-to-doc"]);
      expect(report.folders).toHaveLength(1);

      const copies = drive.nodes.filter((n) => (n.parents ?? []).includes("new1"));
      expect(copies.map((n) => n.mimeType)).toEqual([SHORTCUT_MIME, SHORTCUT_MIME]);
      expect(copies.map((n) => n.target)).toEqual(["1G", "1D"]);
      expect(drive.nodes.some((n) => n.name === "deep.pdf" && n.id !== "1H")).toBe(false);
    });
  });

  describe("when a copy fails part-way (decision 0031 §3)", () => {
    /** Refuses one file, the way a file this account cannot read refuses. */
    const denying = (id: string) => (call: FakeCall) => {
      if (call.method === "copy" && call.id === id) {
        throw driveApiError(403, "The user does not have sufficient permissions for this file.");
      }
    };

    it("stops, and attempts nothing after the failure", async () => {
      const drive = createWritableTreeDrive(twoLevelTree(), { before: denying("1A") });
      const error = await failureFrom(copyTree(drive.client, source, "DEST", { retry: noWait }));

      expect(error).toMatchObject({ code: "PERMISSION_DENIED" });
      expect(drive.trace()).toEqual(["create:DEST", "list:1F", "copy:1A"]);
    });

    it("carries everything finished before it, and the one that failed", async () => {
      // Fails on the second file, so there is a folder and a file to report.
      const drive = createWritableTreeDrive(twoLevelTree(), { before: denying("1B") });
      const error = await failureFrom(copyTree(drive.client, source, "DEST", { retry: noWait }));

      expect(payloadOf(error)).toEqual({
        folders: [
          { src: "1F", dst: "new1", name: "2026" },
          { src: "1S", dst: "new3", name: "sub" },
        ],
        copied: [{ src: "1A", dst: "new2", name: "a.pdf" }],
        failed: { src: "1B", name: "b.txt" },
      });
    });

    it("summarises in text and lists the new ids for a retry loop in quiet", async () => {
      const drive = createWritableTreeDrive(twoLevelTree(), { before: denying("1B") });
      const error = await failureFrom(copyTree(drive.client, source, "DEST", { retry: noWait }));

      expect(dataOf(error)?.text).toContain("2 folders and 1 file");
      expect(dataOf(error)?.text).toContain("b.txt");
      // Every id created, one per line, top folder first: what a shell needs to
      // clean up or resume by hand.
      expect(dataOf(error)?.quiet?.split("\n")).toEqual(["new1", "new3", "new2"]);
    });

    it("leaves a failure that changed nothing exactly as Drive reported it", async () => {
      // The very first create fails, so `success: false` still means what it
      // always did and no `data` is invented to say so (decision 0031 §4).
      const drive = createWritableTreeDrive(twoLevelTree(), {
        before: (call) => {
          if (call.method === "create") throw driveApiError(403, "No write access here.");
        },
      });
      const error = await failureFrom(copyTree(drive.client, source, "DEST", { retry: noWait }));

      expect(error).toMatchObject({ code: "PERMISSION_DENIED", message: "No write access here." });
      expect(dataOf(error)).toBeUndefined();
    });
  });

  describe("when Drive asks for a pause (decision 0031 §5)", () => {
    it("waits out a rate limit, and the retried file is not reported as a failure", async () => {
      const drive = createWritableTreeDrive(twoLevelTree(), {
        before: (call) => {
          if (call.method === "copy" && call.id === "1A" && call.attempt < 3) {
            throw driveApiError(429, "Rate Limit Exceeded", "userRateLimitExceeded");
          }
        },
      });
      const report = await copyTree(drive.client, source, "DEST", { retry: noWait });

      expect(drive.calls.filter((c) => c.method === "copy" && c.id === "1A")).toHaveLength(3);
      expect(report.copied.map((c) => c.src)).toEqual(["1A", "1B"]);
    });

    it("gives up after a bounded number of them, and stops like any other failure", async () => {
      const drive = createWritableTreeDrive(twoLevelTree(), {
        before: (call) => {
          if (call.method === "copy" && call.id === "1A") {
            throw driveApiError(429, "Rate Limit Exceeded", "userRateLimitExceeded");
          }
        },
      });
      const error = await failureFrom(
        copyTree(drive.client, source, "DEST", { retry: { ...noWait, attempts: 3 } }),
      );

      expect(drive.calls.filter((c) => c.method === "copy" && c.id === "1A")).toHaveLength(3);
      expect(payloadOf(error)).toMatchObject({ failed: { src: "1A", name: "a.pdf" } });
      // Nothing after it was attempted, rate limit or not.
      expect(drive.trace().filter((c) => c !== "copy:1A")).toEqual(["create:DEST", "list:1F"]);
    });

    it("does not wait out a refusal", async () => {
      const drive = createWritableTreeDrive(twoLevelTree(), {
        before: (call) => {
          if (call.method === "copy") {
            throw driveApiError(403, "No.", "insufficientFilePermissions");
          }
        },
      });
      await failureFrom(copyTree(drive.client, source, "DEST", { retry: noWait }));
      expect(drive.calls.filter((c) => c.method === "copy")).toHaveLength(1);
    });
  });

  /**
   * A folder with more children than one `files.list` page returns is ordinary,
   * and a walk that reads only the first page copies a subset without saying so
   * — the exact failure the complete report of decision 0031 §4 exists to make
   * impossible.
   */
  it("copies every child of a folder that spans several pages", async () => {
    const many: DriveNode[] = [
      { id: "DEST", name: "Archive", mimeType: FOLDER_MIME },
      { id: "1F", name: "2026", mimeType: FOLDER_MIME },
      ...Array.from({ length: 250 }, (_, i) => ({
        id: `f${i}`,
        name: `file-${i}.txt`,
        mimeType: "text/plain",
        parents: ["1F"],
      })),
    ];
    const drive = createWritableTreeDrive(many, { pageSize: 100 });
    const report = await copyTree(drive.client, source, "DEST");

    expect(report.copied).toHaveLength(250);
    expect(drive.calls.filter((c) => c.method === "copy")).toHaveLength(250);
    expect(drive.nodes.filter((n) => (n.parents ?? []).includes("new1"))).toHaveLength(250);
  });
});
