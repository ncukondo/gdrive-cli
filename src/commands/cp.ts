import { Command } from "commander";
import { AppError, type CommandResult, type DriveFile, type OutputFormat } from "../types/index.ts";
import type { CopyTreeReport } from "../lib/copy-tree.ts";
import { formatValues, line, renderSuccess } from "../lib/output.ts";

export interface CpDeps {
  /** The file to copy, as an entry in a folder: a shortcut copies itself. */
  resolvePath: (arg: string) => Promise<string>;
  /** The destination, as a container: a shortcut to a folder copies *into* it. */
  resolveFolder: (arg: string) => Promise<string>;
  copyFile: (fileId: string, parentId: string, name?: string) => Promise<DriveFile>;
  /**
   * Metadata, for the two things that need it and nothing else: the folder hint
   * on a failed copy (decision 0031 §1) and the ancestors of the destination
   * (§6). An ordinary `cp` calls it not at all.
   */
  getFile: (fileId: string) => Promise<DriveFile>;
  copyTree: (source: DriveFile, destId: string, name?: string) => Promise<CopyTreeReport>;
  file: string;
  dest: string;
  name?: string;
  /** `-r`: copy a folder and everything in it (decision 0031 §1). */
  recursive?: boolean;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * Replaces Drive's refusal with one that says what to do about it
 * (decision 0031 §1).
 *
 * Run only *after* the copy failed, so an ordinary `cp` pays nothing for a case
 * that ends in an error anyway — the shape decision 0019 §3's shared-drive hint
 * already uses. And like that one, it never replaces the caller's error when its
 * own lookup fails: a hint is a nicety, and losing a real error to one is not.
 */
async function folderHintFor(deps: CpDeps, fileId: string, error: unknown): Promise<unknown> {
  let source: DriveFile;
  try {
    source = await deps.getFile(fileId);
  } catch {
    return error;
  }
  if (source.type !== "folder") return error;
  return new AppError(
    "INVALID_ARGS",
    `"${deps.file}" is a folder, and Drive cannot copy one in a single request. Use \`gdrive cp -r "${deps.file}" "${deps.dest}"\` to copy it and everything in it.`,
  );
}

/**
 * Refuses `cp -r A A` and `cp -r A A/B` before anything is copied
 * (decision 0031 §6), by walking the destination's ancestors — one `files.get`
 * per level, typically two or three, paid once. Detecting the cycle during the
 * walk instead would mean noticing it after copying part of a tree into itself.
 *
 * The walk is breadth-first over `parents` rather than up a single chain,
 * because Drive's file resource is still a list of them, and a source reachable
 * through any one of them is a source the copy would recurse into. Ids are
 * compared, never names: a destination that merely shares a name with the source
 * is a different folder.
 */
async function refuseCycle(deps: CpDeps, fileId: string, destId: string): Promise<void> {
  const seen = new Set<string>();
  let frontier = [destId];

  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      if (id === fileId) {
        throw new AppError(
          "INVALID_ARGS",
          `Cannot copy "${deps.file}" into itself: "${deps.dest}" is the folder or lives inside it.`,
        );
      }
      if (seen.has(id)) continue;
      seen.add(id);
      const file = await deps.getFile(id);
      next.push(...file.parents);
    }
    frontier = next;
  }
}

/** Two roles, two deps — see {@link handleMv} and decision 0025 §1. */
export async function handleCp(deps: CpDeps): Promise<CommandResult> {
  const fileId = await deps.resolvePath(deps.file);
  const destId = await deps.resolveFolder(deps.dest);

  if (deps.recursive === true) {
    // `-r` needs the metadata anyway, so nothing here is a hint: a folder is
    // walked, and anything else is copied as POSIX `cp -r` copies it (§1).
    const source = await deps.getFile(fileId);
    if (source.type === "folder") {
      await refuseCycle(deps, fileId, destId);
      const report = await deps.copyTree(source, destId, deps.name);
      const { root } = report;
      deps.write(
        renderSuccess(
          {
            data: { file: root, folders: report.folders, copied: report.copied },
            text: line`Copied to ${root.name} (${root.id}): ${count(report.folders.length, "folder")}, ${count(report.copied.length, "file")}`,
            quiet: formatValues([root.id]),
          },
          deps.format,
          deps.quiet,
        ),
      );
      return { exitCode: 0 };
    }
  }

  let copy: DriveFile;
  try {
    copy = await deps.copyFile(fileId, destId, deps.name);
  } catch (error) {
    // Already known not to be a folder when `-r` was given, so the hint would
    // only spend a call to say nothing.
    if (deps.recursive === true) throw error;
    throw await folderHintFor(deps, fileId, error);
  }

  deps.write(
    renderSuccess(
      {
        data: { file: copy },
        text: line`Copied to ${copy.name} (${copy.id})`,
        quiet: formatValues([copy.id]),
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createCpCommand(): Command {
  return new Command("cp")
    .description("Copy a file into a folder, or a whole folder tree with -r")
    .argument("<file>", "File or folder ID or path")
    .argument("<folder>", "Destination folder ID or path")
    .option("-r, --recursive", "Copy a folder and everything in it")
    .option("--name <name>", "Name for the copy");
}
