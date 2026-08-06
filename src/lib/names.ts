import { AppError } from "../types/index.ts";
import { DRIVE_PREFIX, readArgument } from "./resolve-path.ts";

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
   * What to do instead, spelled out, for a command that takes no name at all —
   * `mv` carries a name rather than giving one, so "pass a different name" is
   * advice it cannot follow.
   */
  remedy?: string;
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
 * Decision 0056 §2's test, asked of the resolver rather than restated: a name is
 * addressable when passing it back to `resolvePath` would return the file it
 * names. `readArgument` is the front matter of that walk, so this reads "the
 * resolver would take this name as one path segment, spelled exactly as given" —
 * and every other reading it has is a way the name goes somewhere else.
 *
 * A whole name rather than the tail of a path is the only form these commands
 * can ask about: they know the destination folder's *id*, never a path to it.
 * It is also the strict reading, and the one that is uniform — a leading space
 * survives at depth (`Reports/ Notes` finds the file) but not at My Drive's
 * root, and a rule that held in one folder and not another would be worse than
 * one that holds everywhere.
 *
 * 0055 §1 enumerated two of the ways instead, and was three short within a day.
 * This asks the code, so a sixth reading added to {@link readArgument} is
 * refused here without anybody remembering to come back.
 */
export function isAddressableName(name: string): boolean {
  const reading = readArgument(name);
  return reading.kind === "path" && reading.segments.length === 1 && reading.segments[0] === name;
}

/**
 * A name close to the one asked for that {@link isAddressableName} accepts, or
 * null when nothing near it does.
 *
 * The candidates are ordered by how little they change: trim, de-slash,
 * disambiguate, de-colon, prefix. The last three are for the readings with no
 * natural repair — a root spelling and an id-shaped name are fixed by anything
 * that makes them longer, a `drive:` prefix only by breaking the prefix.
 *
 * Every candidate is run through the same check the refusal used, so a message
 * can never propose a name that would be refused in turn, and a reading nothing
 * here repairs simply yields no suggestion rather than a wrong one.
 */
function nearestAddressable(name: string): string | null {
  const base = name.replaceAll("/", "-").trim();
  if (base === "") return null;
  const candidates = [name.trim(), base, `${base} (2)`, base.replaceAll(":", "-"), `A ${base}`];
  return candidates.find((candidate) => candidate !== name && isAddressableName(candidate)) ?? null;
}

/**
 * Which of the readings swallowed the name, in the caller's terms. The list is
 * decision 0056 §2's five, and it is a `switch` over {@link readArgument}'s own
 * result rather than a second set of string tests, so a reading that grows a
 * member cannot be described here as something it is not.
 */
function whyUnpathable(name: string): string | null {
  const reading = readArgument(name);
  switch (reading.kind) {
    case "root":
      return name.trim() === ""
        ? `A file needs a name: "${name}" is empty or only whitespace.`
        : `"${name}" is how a path names the My Drive root, so a path argument spelling it never reaches a file.`;
    case "id":
      return `"${name}" has the shape of a Drive file id — 20 or more of "A-Z a-z 0-9 _ -" with no "/" — so a path argument spelling it is handed to Drive as an id and never reaches this file.`;
    case "drive":
      return `"${name}" begins with "${DRIVE_PREFIX}", which a path argument reads as a shared drive name, so nothing could then find the file by that name.`;
    case "path":
      if (isAddressableName(name)) return null;
      return name.includes("/")
        ? `"${name}" contains "/", which separates one path segment from the next, so nothing could then find the file by that name.`
        : `"${name}" begins or ends with whitespace, and a path argument is trimmed before it is matched, so nothing could then find the file by that name.`;
  }
}

/**
 * Decision 0055 §1's second case, as decision 0056 §2 widened it: a name that
 * cannot survive a path, in any of the five ways a path can lose one.
 *
 * Nothing here is asked of Drive, so this half runs before any lookup at all.
 */
export function refuseUnpathableName(name: string, flag?: string): void {
  const why = whyUnpathable(name);
  if (why === null) return;
  const fix = nearestAddressable(name);
  throw new AppError("INVALID_ARGS", fix === null ? why : `${why} ${instead(fix, flag)}`);
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
  const remedy = check.remedy ?? instead(`${check.name} (2)`, check.flag);
  throw new AppError(
    "INVALID_ARGS",
    `${where} already holds a file called "${check.name}" (${ids}), and a path naming it would then match both. ${remedy}`,
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
