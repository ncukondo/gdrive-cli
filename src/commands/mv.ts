import { Command } from "commander";
import type { CommandResult, DriveFile, OutputFormat } from "../types/index.ts";
import { formatValues, line, renderSuccess } from "../lib/output.ts";
import { refuseTakenName, type FindSiblings } from "../lib/names.ts";

export interface MvDeps {
  /** The file to move, as an entry in a folder: a shortcut moves itself. */
  resolvePath: (arg: string) => Promise<string>;
  /** The destination, as a container: a shortcut to a folder moves *into* it. */
  resolveFolder: (arg: string) => Promise<string>;
  moveFile: (fileId: string, newParentId: string) => Promise<DriveFile>;
  /** The name the file carries into the destination (decision 0055 §1). */
  getFile: (fileId: string) => Promise<DriveFile>;
  /** What that name would collide with there. */
  findSiblings: FindSiblings;
  file: string;
  dest: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

/**
 * `mv` is why decision 0025 attaches following to the argument rather than the
 * command: its two arguments play different roles, so they get different deps.
 *
 * Decision 0055 §1 reaches this command as well, though its task had excluded
 * it: a move duplicates no file, but §1 is about two files with one name *in one
 * folder*, and a move into a folder already holding that name produces that pair
 * as surely as a copy does. Only the first of §1's two cases applies — `mv`
 * carries a name rather than giving one, and a file whose name a path could
 * never hold is not made worse by moving, while refusing would strand it.
 */
export async function handleMv(deps: MvDeps): Promise<CommandResult> {
  const fileId = await deps.resolvePath(deps.file);
  const destId = await deps.resolveFolder(deps.dest);

  // The name is the file's own, so it takes a lookup to learn — the second round
  // trip decision 0055 §2 spends on `rename`, for the same reason.
  const moving = await deps.getFile(fileId);
  await refuseTakenName({
    name: moving.name,
    parentId: destId,
    findSiblings: deps.findSiblings,
    where: deps.dest,
    selfId: moving.id,
    // The suggestion is handed in already checked, never built from
    // `moving.name`: `mv` is the one caller that gets here without the
    // unpathable check having run (decision 0056 §1), so the name it carries may
    // be one `rename` would itself refuse — `"a/b (2)"` is not advice.
    remedy: (suggestion) =>
      `Rename one of them first, e.g. \`gdrive rename "${deps.file}" "${suggestion}"\`.`,
  });

  const file = await deps.moveFile(fileId, destId);

  deps.write(
    renderSuccess(
      {
        data: { file },
        text: line`Moved ${file.name} to ${destId}`,
        quiet: formatValues([file.id]),
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createMvCommand(): Command {
  return new Command("mv")
    .description("Move a file to another folder")
    .argument("<file>", "File ID or path")
    .argument("<folder>", "Destination folder ID or path");
}
