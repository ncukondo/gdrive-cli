import { Command } from "commander";
import type { CommandResult, DriveFile, OutputFormat } from "../types/index.ts";
import { formatValues, line, renderSuccess } from "../lib/output.ts";
import { refuseUnaddressableName, refuseUnpathableName, type FindSiblings } from "../lib/names.ts";

export interface RenameDeps {
  /** The file to rename, as an entry: renaming a shortcut renames the shortcut. */
  resolvePath: (arg: string) => Promise<string>;
  renameFile: (fileId: string, name: string) => Promise<DriveFile>;
  /** The file's own parents — the folder the new name has to be unique in. */
  getFile: (fileId: string) => Promise<DriveFile>;
  /** What the new name would collide with there (decision 0055 §1). */
  findSiblings: FindSiblings;
  file: string;
  name: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

/**
 * Renames a file (decision 0052). The argument is an entry — 0025 §1's role
 * table — so a shortcut is renamed rather than what it points at.
 *
 * There is no per-type behaviour and no report: Drive carries the new name into
 * the in-document title of a Doc, a Sheet, a deck and a form alike, a form's
 * only a few seconds later (decision 0053).
 */
export async function handleRename(deps: RenameDeps): Promise<CommandResult> {
  // Before the path walk, which is itself a Drive call: Drive would take a blank
  // name, or one ending in a space, and leave a file nothing can address by path
  // (decision 0055 §1). The null parent asks only what holds in *every* folder,
  // which is all that can be known before the walk says which folder that is —
  // the readings that bite only at a drive root are checked below, once there is
  // an answer to check them against.
  refuseUnpathableName(deps.name, null);

  const fileId = await deps.resolvePath(deps.file);

  // The second round trip decision 0055 §2 allows this one command: `rename` is
  // the only one that does not already know the folder its result lands in, and
  // the collision it has to rule out is with that folder's other entries. The
  // file itself is not one of them — renaming it to the name it already has is a
  // no-op, not a collision. `parents` is read as the list Drive's resource still
  // makes it, so a file reachable through two folders is checked in both.
  const file = await deps.getFile(fileId);
  for (const parentId of file.parents) {
    await refuseUnaddressableName({
      name: deps.name,
      parentId,
      findSiblings: deps.findSiblings,
      selfId: file.id,
    });
  }

  const renamed = await deps.renameFile(fileId, deps.name);

  deps.write(
    renderSuccess(
      {
        data: { file: renamed },
        text: line`Renamed to ${renamed.name} (${renamed.id})`,
        quiet: formatValues([renamed.id]),
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createRenameCommand(): Command {
  return new Command("rename")
    .description("Change a file's name")
    .argument("<file>", "File ID or path")
    .argument("<name>", "New name");
}
