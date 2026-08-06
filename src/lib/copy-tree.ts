import { AppError, errorToCode, type DriveFile } from "../types/index.ts";
import {
  copyFile,
  createFolder,
  listChildren,
  withRetry,
  type DriveClient,
  type RetryOptions,
} from "./api.ts";
import { formatValues, line } from "./output.ts";

/**
 * The recursive copy Drive has no request for (decision 0031). `files.copy`
 * refuses a folder, so the only way is to create the destination folder, list
 * the source, copy each file, and recurse — which is what this does, in one
 * process rather than the `2F + N` the caller would otherwise launch.
 *
 * It lives apart from the command because the two things worth getting right
 * here — the order the tree is built in, and what a stopped run reports — are
 * testable without a command around them.
 */

/** One file or folder the walk reproduced (decision 0031 §4). */
export interface CopiedEntry {
  /** The source's id. */
  src: string;
  /** The copy's id. */
  dst: string;
  name: string;
}

/** What the walk got through. */
export interface CopyTreeReport {
  /** The copy of the source folder itself. `folders[0]` describes the same one. */
  root: DriveFile;
  /** Every folder created, the top one first, in creation order. */
  folders: CopiedEntry[];
  /** Every file copied, in copy order; a shortcut counts as a file (§2). */
  copied: CopiedEntry[];
}

export interface CopyTreeOptions {
  /**
   * Renames the top-level copy. Everything below keeps the name it had — which
   * only holds because every level names itself in its request; left to Drive,
   * some of them would not.
   */
  name?: string;
  /** Passed to {@link withRetry}; tests inject a `sleep` that does not sleep. */
  retry?: RetryOptions;
}

/**
 * The one thing the walk did not get through (decision 0031 §4), and which of
 * two quite different things that is.
 *
 * `copying` means nothing was created for it: it appears in neither `folders`
 * nor `copied`, and it is the one to try again. `listing` means the opposite —
 * the folder's copy exists, `dst` names it and `folders` holds it too, and what
 * is missing is what was inside it. Copying `src` again would make a second
 * folder rather than fill the one that is there.
 */
export interface FailedEntry {
  src: string;
  name: string;
  stage: "copying" | "listing";
  /** The copy that does exist. Only on `listing`; there is none to name otherwise. */
  dst?: string;
}

/** What the walk had done when it stopped, and what stopped it (decision 0031 §4). */
interface Progress {
  folders: CopiedEntry[];
  copied: CopiedEntry[];
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * Turns what was done into the report a caller reads off a failure.
 *
 * Quiet is every id created, in creation order and folders first, because that
 * is what a shell needs to undo or resume the run by hand — the top folder,
 * which `folders[0]` always is, being the one id that removes the lot.
 */
function progressData(progress: Progress, failed: FailedEntry) {
  const { folders, copied } = progress;
  const done = line`Copied ${count(folders.length, "folder")} and ${count(copied.length, "file")}`;
  const stopped =
    failed.stage === "listing"
      ? line`; the copy of ${failed.name} (${failed.src}) exists but nothing inside it was listed, so it is empty.`
      : line` before ${failed.name} (${failed.src}) failed.`;
  return {
    payload: { folders, copied, failed },
    text: `${done}${stopped} What was copied is under the new folder and was left there.`,
    quiet: formatValues([...folders, ...copied].map((entry) => entry.dst)),
  };
}

/**
 * Runs one Drive call, waiting out a rate limit (§5) and attaching the report to
 * whatever finally fails (§3 and §4 — stopping early is only defensible because
 * the report is complete).
 *
 * A failure before anything was created is re-thrown untouched: nothing changed,
 * so `success: false` means what it always meant and there is no partial result
 * to describe.
 *
 * Once something *has* been created, every failure carries the report, whatever
 * class it arrived as. A dropped socket is a plain `Error` and a bug in this
 * program is a `TypeError`; neither is an `AppError`, and requiring one threw
 * the report away for the failure a long run is likeliest to meet. `errorToCode`
 * decides the code, so it is the same one `handleError` would have derived from
 * the original — the exit code stays the underlying failure's, which is what
 * §3 promises.
 */
async function attempt<T>(
  progress: Progress,
  what: FailedEntry,
  options: CopyTreeOptions,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await withRetry(call, options.retry ?? {});
  } catch (error) {
    const changed = progress.folders.length + progress.copied.length > 0;
    if (!changed) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError(errorToCode(error), message, { data: progressData(progress, what) });
  }
}

/**
 * Fills `dstId` with copies of everything in `srcId`, depth first.
 *
 * A folder is created before anything is copied into it, and a **shortcut is
 * copied rather than followed** even when it points at a folder (§2): the walk
 * enumerates entries, and an entry never follows (decision 0025 §1).
 * `files.copy` on a shortcut duplicates the pointer, so it needs no case of its
 * own here — only the `folder` branch recurses.
 */
async function fill(
  client: DriveClient,
  progress: Progress,
  src: { id: string; name: string },
  dstId: string,
  options: CopyTreeOptions,
): Promise<void> {
  // `listing`, not `copying`: `dstId` was created before this call and is in
  // the report already, so what a failure here loses is the folder's contents.
  const children = await attempt(
    progress,
    { src: src.id, name: src.name, stage: "listing", dst: dstId },
    options,
    () => listChildren(client, src.id),
  );

  for (const child of children) {
    const what: FailedEntry = { src: child.id, name: child.name, stage: "copying" };
    if (child.type === "folder") {
      const folder = await attempt(progress, what, options, () =>
        createFolder(client, child.name, dstId),
      );
      progress.folders.push({ src: child.id, dst: folder.id, name: folder.name });
      await fill(client, progress, child, folder.id, options);
      continue;
    }
    // The name is sent, never left to Drive. Drive's default for an unnamed
    // copy is not the source's name and is not even uniform: a Google-native
    // document comes back as `Copy of <name>` while a binary file beside it
    // keeps its own, so a tree copied without it is a tree half of whose files
    // were silently renamed.
    const copy = await attempt(progress, what, options, () =>
      copyFile(client, child.id, dstId, child.name),
    );
    progress.copied.push({ src: child.id, dst: copy.id, name: copy.name });
  }
}

/**
 * Reproduces `source` inside `destId` and reports every id it created
 * (decision 0031). Stops at the first failure Drive will not take back, and
 * throws an {@link AppError} carrying that report.
 *
 * The caller supplies `source` already resolved, because deciding that it *is* a
 * folder is the command's job — `cp -r` on an ordinary file is a plain copy.
 */
export async function copyTree(
  client: DriveClient,
  source: { id: string; name: string },
  destId: string,
  options: CopyTreeOptions = {},
): Promise<CopyTreeReport> {
  const progress: Progress = { folders: [], copied: [] };
  const name = options.name ?? source.name;

  const root = await attempt(progress, { src: source.id, name, stage: "copying" }, options, () =>
    createFolder(client, name, destId),
  );
  progress.folders.push({ src: source.id, dst: root.id, name: root.name });

  await fill(client, progress, source, root.id, options);
  return { root, folders: progress.folders, copied: progress.copied };
}
