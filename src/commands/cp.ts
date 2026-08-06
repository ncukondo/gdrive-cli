import { Command } from "commander";
import { AppError, type CommandResult, type DriveFile, type OutputFormat } from "../types/index.ts";
import type { CopyTreeReport } from "../lib/copy-tree.ts";
import { formatValues, line, renderSuccess } from "../lib/output.ts";
import { ROOT_ID } from "../lib/resolve-path.ts";

export interface CpDeps {
  /** The file to copy, as an entry in a folder: a shortcut copies itself. */
  resolvePath: (arg: string) => Promise<string>;
  /** The destination, as a container: a shortcut to a folder copies *into* it. */
  resolveFolder: (arg: string) => Promise<string>;
  copyFile: (fileId: string, parentId: string, name?: string) => Promise<DriveFile>;
  /**
   * Metadata: the source's name (decision 0054 §1) and its parents (§3), and
   * the destination's ancestors (decision 0031 §6).
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
 * The message decision 0031 §1 chose, in place of Drive's own refusal, which
 * mentions neither folders nor `-r`.
 *
 * 0031 §1 produced it only *after* `files.copy` had failed, to keep an ordinary
 * copy to a single round trip. Decision 0054 spends that round trip on every
 * copy — §1 has to know the source's name and §3 its parents — so there is
 * nothing left to save by finding out on the failure path, and the refusal now
 * happens before anything is attempted. What a caller sees is unchanged: the
 * same message, the same `INVALID_ARGS`.
 */
function folderNeedsRecursive(deps: CpDeps): AppError {
  return new AppError(
    "INVALID_ARGS",
    `"${deps.file}" is a folder, and Drive cannot copy one in a single request. Use \`gdrive cp -r "${deps.file}" "${deps.dest}"\` to copy it and everything in it.`,
  );
}

/**
 * Refuses a copy that would land beside its own source under the same name
 * (decision 0054 §3). Drive would not refuse it; it would produce twins that no
 * listing tells apart and no path can address, so the message names the flag
 * that fixes it.
 *
 * `--name` settles the question before it is asked, which is why it is the one
 * case that skips the check rather than passing it.
 *
 * `root` is an alias Drive accepts, not an id: a file in My Drive's root carries
 * the root's *real* id in `parents`, so comparing the two as strings would let
 * the very case §3 exists for — a snapshot taken in place — through. Resolving
 * it costs one `files.get`, and only when the destination was spelled that way.
 */
async function refuseSibling(deps: CpDeps, source: DriveFile, destId: string): Promise<void> {
  if (deps.name !== undefined) return;
  const parentId = destId === ROOT_ID ? (await deps.getFile(destId)).id : destId;
  if (!source.parents.includes(parentId)) return;
  throw new AppError(
    "INVALID_ARGS",
    `"${deps.file}" is already in "${deps.dest}", so copying it there would leave two files called "${source.name}" that nothing can tell apart. Give the copy a name: --name "${source.name} (copy)".`,
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
 *
 * `sourceId` must be the id Drive answered with, never the argument the caller
 * typed. `resolvePath` returns the literal alias `root` for `""`, `"/"` and
 * `"root"`, and a `parents` list carries My Drive's *real* id — so the alias
 * matches no ancestor, every check passes, and `cp -r / Archive` copies My Drive
 * into a folder inside My Drive and then keeps finding the copy it just made.
 * The same alias is resolved on the destination side in {@link refuseSibling},
 * for the same reason.
 */
async function refuseCycle(deps: CpDeps, sourceId: string, destId: string): Promise<void> {
  const seen = new Set<string>();
  let frontier = [destId];

  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      if (id === sourceId) {
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

  // One lookup answers everything `cp` has to decide before it copies: what the
  // copy is called (decision 0054 §1), whether it would land beside its source
  // (§3), and whether a folder was named without `-r` (decision 0031 §1). It is
  // unconditional because 0054 §1 is: one rule, no branch on the file's type and
  // none on how it was reached.
  const source = await deps.getFile(fileId);
  const name = deps.name ?? source.name;

  if (source.type === "folder" && deps.recursive !== true) throw folderNeedsRecursive(deps);
  await refuseSibling(deps, source, destId);

  if (source.type === "folder") {
    // `source.id`, not `fileId`: the argument may still be the `root` alias.
    await refuseCycle(deps, source.id, destId);
    const report = await deps.copyTree(source, destId, name);
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

  // `-r` on an ordinary file copies it, as POSIX `cp -r` does (decision 0031 §1).
  const copy = await deps.copyFile(fileId, destId, name);

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
