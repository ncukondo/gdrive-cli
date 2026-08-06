import { AppError } from "../types/index.ts";

/**
 * The one check behind decision 0055 §1: a name this CLI could not afterwards
 * use to find the file it named is refused, by every command that hands a file
 * a name. There is one implementation because there is one rule — nine copies
 * is how 0054 §3 came to cover `cp` and nothing else.
 */

/** What a sibling lookup has to answer with: enough to name what is in the way. */
export interface Sibling {
  id: string;
  name: string;
}

/**
 * Lists the entries directly inside `parentId` that carry exactly `name`.
 *
 * The wiring passes `childrenNamed` from `resolve-path.ts` — the same lookup a
 * path walk does for one segment — so "a sibling" and "what a path segment
 * would match" cannot drift apart.
 */
export type FindSiblings = (parentId: string, name: string) => Promise<Sibling[]>;

/**
 * The folder a file lands in when the caller named none — every command with an
 * optional `--parent` says this, and it is what the refusal has to look in.
 */
export const MY_DRIVE = "My Drive";

export interface NameCheck {
  /** The name the caller asked for. */
  name: string;
  /** The folder it would land in; the `root` alias when the caller named none. */
  parentId: string;
  findSiblings: FindSiblings;
  /** How the caller spelled that folder, for the message. */
  where?: string;
  /** The flag that carries a name, on the commands that have one. */
  flag?: string;
  /**
   * The file already carrying the name, on the commands that move or rename one
   * rather than create one. It is not its own collision: `mv` into the folder a
   * file is already in, and `rename` to the name it already has, are no-ops.
   */
  selfId?: string;
}

/** "Pass this instead", phrased for a command with a name flag and one without. */
function instead(name: string, flag?: string): string {
  return flag === undefined ? `Use "${name}".` : `Pass ${flag} "${name}".`;
}

/**
 * Decision 0055 §1's second case: a name that cannot survive a path.
 *
 * What "survive" means is decided by `resolve-path.ts`, and by what it actually
 * does rather than by any description of it. It trims the **whole argument**
 * before splitting it — not each segment — so a name with whitespace at either
 * end is unreachable exactly where it sits at an end of the path, and a file's
 * own name is always the last segment of the path that names it. A `/` needs no
 * such argument: it splits the segment wherever the name appears.
 *
 * Nothing here is asked of Drive, so this half runs before any lookup at all.
 */
export function refuseUnpathableName(name: string, flag?: string): void {
  if (name.trim() === "") {
    throw new AppError(
      "INVALID_ARGS",
      `A file needs a name: "${name}" is empty or only whitespace.`,
    );
  }
  if (name !== name.trim()) {
    throw new AppError(
      "INVALID_ARGS",
      `"${name}" begins or ends with whitespace, and a path argument is trimmed before it is matched, so nothing could then find the file by that name. ${instead(name.trim(), flag)}`,
    );
  }
  if (name.includes("/")) {
    throw new AppError(
      "INVALID_ARGS",
      `"${name}" contains "/", which separates one path segment from the next, so nothing could then find the file by that name. ${instead(name.replaceAll("/", "-"), flag)}`,
    );
  }
}

/**
 * Decision 0055 §1's first case: a name a sibling already holds. Two files with
 * one name in one folder make `resolve-path.ts` answer *Ambiguous path segment*
 * for **both**, so the harm falls on the file that was already there as much as
 * on the new one.
 *
 * It is one query, against a folder every caller knows before it writes (§2).
 */
export async function refuseTakenName(check: NameCheck): Promise<void> {
  const taken = (await check.findSiblings(check.parentId, check.name)).filter(
    (sibling) => sibling.id !== check.selfId,
  );
  if (taken.length === 0) return;

  const where = check.where === undefined ? "That folder" : `"${check.where}"`;
  const ids = taken.map((sibling) => sibling.id).join(", ");
  throw new AppError(
    "INVALID_ARGS",
    `${where} already holds a file called "${check.name}" (${ids}), and a path naming it would then match both. ${instead(`${check.name} (2)`, check.flag)}`,
  );
}

/**
 * Both halves of decision 0055 §1, in the order that spends the fewest round
 * trips: the free check first, then the one query. Every caller that creates a
 * file uses this; `rename` is the exception, and only because it can run the
 * free half before the path walk it would otherwise pay for a blank name.
 */
export async function refuseUnaddressableName(check: NameCheck): Promise<void> {
  refuseUnpathableName(check.name, check.flag);
  await refuseTakenName(check);
}
