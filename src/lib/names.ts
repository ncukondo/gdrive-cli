import { AppError } from "../types/index.ts";
import { DRIVE_PREFIX, isDriveRoot, lookupSegments, readArgument } from "./resolve-path.ts";

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
   * What to do instead, for a command that takes no name at all — `mv` carries
   * a name rather than giving one, so "pass a different name" is advice it
   * cannot follow. The suggestion handed in has already been checked against
   * {@link isAddressableName}, so a caller must build its sentence around that
   * rather than around the name it started from.
   */
  remedy?: (suggestion: string) => string;
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
 * Stands in for whatever comes before the name in the path that reaches it. Any
 * ordinary segment will do: only the *last* one is under test.
 */
const AHEAD = "A";

/**
 * The path a caller would type to name a file called `name` in `parentId`.
 *
 * At a drive root the name is the whole argument. Anywhere else at least one
 * segment comes first — including inside a shared drive, where the argument is
 * `drive:<Name>/<name>` and {@link lookupSegments} has already dropped the
 * drive's own segment, so the name is never the first there either.
 *
 * A null parent means "not known yet", and takes the deeper form: what is
 * unreachable with a segment in front of it is unreachable without one too, so
 * that answer holds in every folder. `rename` uses it to refuse a hopeless name
 * before paying for the walk that would tell it the folder.
 */
function pathTo(name: string, parentId: string | null): string {
  return parentId !== null && isDriveRoot(parentId) ? name : `${AHEAD}/${name}`;
}

/**
 * Decision 0056 §2, implemented as it is written: build the path that would name
 * this file *in the folder it now lives in*, hand it to the resolver's own
 * reader, and ask whether the last segment came back spelled exactly like the
 * name. Nothing here restates what the resolver does; it asks.
 *
 * This is deliberately **not** the stricter "the name has to work as a whole
 * argument" rule, which an earlier round of this task shipped. That rule refused
 * `Meeting_notes_2026_08` — twenty-odd word characters is the ordinary shape of
 * a machine-made name — because it is id-shaped as a whole argument, when
 * `Reports/Meeting_notes_2026_08` finds it perfectly well. With no `--force` in
 * the design (0055's `Out of scope`), a false refusal has no way out, so the
 * check has to be exactly as wide as the harm and no wider.
 *
 * What remains parent-dependent is only whether the name is the argument's first
 * segment, and {@link isDriveRoot} decides that from the id alone.
 */
export function isAddressableName(name: string, parentId: string | null): boolean {
  const segments = lookupSegments(pathTo(name, parentId));
  const expected = parentId !== null && isDriveRoot(parentId) ? [name] : [AHEAD, name];
  return segments.length === expected.length && segments.every((s, i) => s === expected[i]);
}

/**
 * A name near the one asked for that {@link isAddressableName} accepts, or null
 * when nothing near it does. The name itself is the first candidate, so this
 * also serves a caller that has a name it merely *hopes* is usable.
 *
 * The rest are ordered by how little they change: trim, de-slash, disambiguate,
 * de-colon, prefix. The last three are for the readings with no natural repair —
 * a root spelling and an id-shaped name are fixed by anything that makes them
 * longer, a `drive:` prefix only by breaking the prefix.
 *
 * Every candidate is run through the same check the refusal used, so no message
 * can propose a name that would be refused in turn, and a reading nothing here
 * repairs yields no suggestion rather than a wrong one.
 */
function addressableNear(name: string, parentId: string | null): string | null {
  const base = name.replaceAll("/", "-").trim();
  if (base === "") return null;
  const candidates = [
    name,
    name.trim(),
    base,
    `${base} (2)`,
    base.replaceAll(":", "-"),
    `A ${base}`,
  ];
  return candidates.find((candidate) => isAddressableName(candidate, parentId)) ?? null;
}

/** How a message says where a refusal bites, when it does not bite everywhere. */
const AT_A_ROOT =
  "at the top of a drive, where the name is the whole path argument — in a subfolder it would be fine";

/**
 * Which reading swallowed the name, in the caller's terms.
 *
 * The order matters and is not arbitrary. A name unreachable even with a segment
 * in front of it failed for one of exactly three reasons, and it is provable
 * rather than enumerated: `A/<name>` can only ever read as a *path*, so the only
 * ways its segments differ from `[AHEAD, name]` are the argument's trailing trim
 * eating the end of the name, a `/` inside the name splitting it, or the name
 * being empty and filtered away. Everything left is a reading that only fires
 * when the name stands alone, which is why the second half says where it bites.
 */
function whyUnpathable(name: string, parentId: string | null): string | null {
  if (isAddressableName(name, parentId)) return null;

  if (!isAddressableName(name, null)) {
    if (name.trim() === "") return `A file needs a name: "${name}" is empty or only whitespace.`;
    if (name.includes("/")) {
      return `"${name}" contains "/", which separates one path segment from the next, so nothing could then find the file by that name.`;
    }
    return `"${name}" ends with whitespace, and a path argument is trimmed before it is matched, so nothing could then find the file by that name.`;
  }

  switch (readArgument(name).kind) {
    case "root":
      return `"${name}" is how a path names a drive's root, so nothing could find the file by that name ${AT_A_ROOT}.`;
    case "id":
      return `"${name}" has the shape of a Drive id — 20 or more of "A-Z a-z 0-9 _ -" with no "/", or a drive root's "0A" and 17 more — so a path argument spelling it is handed to Drive as an id and never reaches the file ${AT_A_ROOT}.`;
    case "drive":
      return `"${name}" begins with "${DRIVE_PREFIX}", which a path argument reads as a shared drive name, so nothing could find the file by that name ${AT_A_ROOT}.`;
    case "path":
      return `"${name}" begins with whitespace, and a path argument is trimmed before it is matched, so nothing could find the file by that name ${AT_A_ROOT}.`;
  }
}

/**
 * Decision 0055 §1's second case, as decision 0056 §2 widened it: a name that
 * cannot survive a path in the folder it would land in.
 *
 * `parentId` is null for a caller that does not know the folder yet, and gets
 * the answer that holds in every folder — see {@link pathTo}.
 *
 * Nothing here is asked of Drive, so this half runs before any lookup at all.
 */
export function refuseUnpathableName(name: string, parentId: string | null, flag?: string): void {
  const why = whyUnpathable(name, parentId);
  if (why === null) return;
  const fix = addressableNear(name, parentId);
  throw new AppError("INVALID_ARGS", fix === null ? why : `${why} ${instead(fix, flag)}`);
}

/**
 * Decision 0055 §1's first case: a name a sibling already holds. Two files with
 * one name in one folder make `resolve-path.ts` answer *Ambiguous path segment*
 * for **both**, so the harm falls on the file that was already there as much as
 * on the new one.
 *
 * It is one query, against a folder every caller knows before it writes (§2).
 *
 * The name it suggests goes through {@link addressableNear} rather than being
 * built by hand. `mv` is why: decision 0056 §1 has it reach this check *without*
 * the unpathable one, so the name it carries may itself be one a path cannot
 * hold, and `"a/b (2)"` is advice `rename` would turn down.
 */
export async function refuseTakenName(check: NameCheck): Promise<void> {
  const taken = (await check.findSiblings(check.parentId, check.name)).filter(
    (sibling) => sibling.id !== check.selfId,
  );
  if (taken.length === 0) return;

  const where = check.where === undefined ? "That folder" : `"${check.where}"`;
  const ids = taken.map((sibling) => sibling.id).join(", ");
  const fix = addressableNear(`${check.name} (2)`, check.parentId);
  const remedy = fix === null ? "" : ` ${check.remedy?.(fix) ?? instead(fix, check.flag)}`;
  throw new AppError(
    "INVALID_ARGS",
    `${where} already holds a file called "${check.name}" (${ids}), and a path naming it would then match both.${remedy}`,
  );
}

/**
 * Both halves of decision 0055 §1, in the order that spends the fewest round
 * trips: the free check first, then the one query. Every caller that creates a
 * file uses this; `rename` is the exception, and only because it can run the
 * free half before the path walk it would otherwise pay for a blank name.
 */
export async function refuseUnaddressableName(check: NameCheck): Promise<void> {
  refuseUnpathableName(check.name, check.parentId, check.flag);
  await refuseTakenName(check);
}
