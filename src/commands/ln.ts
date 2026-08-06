import { Command } from "commander";
import type { CommandResult, DriveFile, OutputFormat } from "../types/index.ts";
import type { ResolvedTarget } from "../lib/resolve-path.ts";
import { formatValues, line, renderSuccess } from "../lib/output.ts";
import { refuseUnaddressableName, type FindSiblings } from "../lib/names.ts";

export interface LnDeps {
  /** The target, as content: a shortcut links what it points at (decision 0026 §2). */
  resolveTarget: (arg: string) => Promise<ResolvedTarget>;
  /** The destination, as a container: a shortcut to a folder links *into* it. */
  resolveFolder: (arg: string) => Promise<string>;
  getFile: (id: string) => Promise<DriveFile>;
  createShortcut: (targetId: string, parentId: string, name: string) => Promise<DriveFile>;
  /** What the shortcut's name would collide with (decision 0055 §1). */
  findSiblings: FindSiblings;
  target: string;
  dest: string;
  name?: string;
  format: OutputFormat;
  quiet: boolean;
  write: (msg: string) => void;
}

/**
 * The name for the new shortcut, and what is known of the target it points at.
 *
 * This is the only place `ln` may fetch, and `--name` is the one case that
 * leaves the target's name unknown: it is naming the shortcut after its target
 * that needs the metadata (decision 0026 §3), and resolving has already paid for
 * it whenever the argument was an id or itself a shortcut (0025 §4).
 */
async function nameFor(
  deps: LnDeps,
  targetId: string,
  known: DriveFile | null,
): Promise<{ name: string; target: DriveFile | null }> {
  if (deps.name !== undefined) return { name: deps.name, target: known };
  const target = known ?? (await deps.getFile(targetId));
  return { name: target.name, target };
}

/** Two roles, two deps — see {@link handleCp} and decisions 0025 §1, 0026 §2. */
export async function handleLn(deps: LnDeps): Promise<CommandResult> {
  const { id: targetId, file } = await deps.resolveTarget(deps.target);
  const folderId = await deps.resolveFolder(deps.dest);
  const { name, target } = await nameFor(deps, targetId, file);

  // Decision 0055 §1–§2. The default name is the target's, so linking one file
  // into one folder twice reaches the collision with no flag involved: two
  // shortcuts, one name, and neither reachable by path afterwards.
  await refuseUnaddressableName({
    name,
    parentId: folderId,
    findSiblings: deps.findSiblings,
    where: deps.dest,
    flag: "--name",
  });

  const link = await deps.createShortcut(targetId, folderId, name);

  // Both ends, because the new id alone does not say the link landed on the
  // right file (decision 0026 §5). `--name` is what can leave the target
  // nameless here, and its id is still the half that identifies it.
  const targetLabel = target === null ? targetId : `${target.name} (${targetId})`;
  deps.write(
    renderSuccess(
      {
        data: { file: link },
        text: line`Created shortcut ${link.name} (${link.id}) -> ${targetLabel}`,
        quiet: formatValues([link.id]),
      },
      deps.format,
      deps.quiet,
    ),
  );
  return { exitCode: 0 };
}

export function createLnCommand(): Command {
  return new Command("ln")
    .description("Create a shortcut to a file in a folder")
    .argument("<target>", "File ID or path the shortcut points at")
    .argument("<folder>", "Folder ID or path to create the shortcut in")
    .option("--name <name>", "Name for the shortcut (the target's name if omitted)");
}
