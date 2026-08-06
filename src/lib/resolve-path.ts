import { AppError, type DriveFile } from "../types/index.ts";
import {
  escapeQueryValue,
  getFile,
  listSharedDrives,
  mapDriveError,
  normalizeFile,
  resolveDriveByName,
  SHARED_DRIVE_ROOT_ID,
  type DriveClient,
} from "./api.ts";

/** The alias Drive accepts for the My Drive root folder. */
export const ROOT_ID = "root";

/** Marks the rest of a path as living on a shared drive (decision 0019). */
export const DRIVE_PREFIX = "drive:";

const FILE_ID = /^[A-Za-z0-9_-]{20,}$/;

/**
 * Matching the exact shape Drive issues for a drive root (`SHARED_DRIVE_ROOT_ID`
 * in `api.ts`), rather than lowering the general threshold to 19, keeps the
 * false-positive surface where it was: a 19-character slash-free folder name is
 * already implausible, and one that also starts with `0A` more so
 * (decision 0016 §3).
 *
 * Heuristic for "this argument is a Drive file ID, not a path". Drive IDs are
 * long, slash-free, `[A-Za-z0-9_-]` strings; folder names are typically shorter
 * and/or contain spaces. Per decision 0008 an ID-looking argument wins.
 */
export function looksLikeId(arg: string): boolean {
  return FILE_ID.test(arg) || SHARED_DRIVE_ROOT_ID.test(arg);
}

export interface Candidate {
  id: string;
  name: string;
  /** True when this entry is a pointer rather than a file (decision 0025). */
  isShortcut: boolean;
  /** `shortcutDetails.targetId`, or null on anything that is not a shortcut. */
  targetId: string | null;
}

/**
 * The entries directly inside `parentId` carrying exactly `name` — one segment
 * of a path walk.
 *
 * It is exported because decision 0055 §1's refusal is defined *as* this
 * lookup: a name is taken when a path segment spelling it would match something
 * already there, and the only way for the two to stay the same question is for
 * them to be the same query.
 */
export async function childrenNamed(
  client: DriveClient,
  parentId: string,
  name: string,
): Promise<Candidate[]> {
  const q = [
    `name = '${escapeQueryValue(name)}'`,
    `'${escapeQueryValue(parentId)}' in parents`,
    "trashed = false",
  ].join(" and ");
  try {
    const res = await client.files.list({
      q,
      pageSize: 100,
      // The target rides along with every segment, so following one costs no
      // second lookup (decision 0025 §4).
      fields: "files(id,name,mimeType,shortcutDetails(targetId,targetMimeType))",
      supportsAllDrives: true,
      // The query already pins one parent, so this cannot widen the result
      // set — only stop it being empty inside a shared drive (0016 §2, 0019 §4).
      includeItemsFromAllDrives: true,
    });
    return (res.data.files ?? []).map((raw) => {
      const f = normalizeFile(raw);
      return {
        id: f.id,
        name: f.name,
        isShortcut: f.type === "shortcut",
        targetId: f.target_id,
      };
    });
  } catch (error) {
    mapDriveError(error);
  }
}

/**
 * What the resolver makes of an argument *before* it asks Drive anything —
 * every way a `<file>` argument can mean something other than "one segment
 * spelled exactly like this".
 *
 * It is a named function rather than a paragraph because two callers have to
 * agree on it: {@link walk}, which acts on the reading, and decision 0056 §2's
 * refusal, which asks whether a name would survive it. 0055 §1 described this
 * front matter instead of naming it, and the description was wrong within a day.
 * A sixth reading added here is a sixth name refused there, and it cannot be
 * added to one without the other.
 */
export type Reading =
  | { kind: "root" }
  | { kind: "id"; id: string }
  | { kind: "drive"; rest: string }
  | { kind: "path"; segments: string[] };

/** Reads an argument the way {@link walk} does, without looking anything up. */
export function readArgument(arg: string): Reading {
  // The trim is of the *whole argument*, once, and the split comes after it —
  // so a leading space is lost only from the first segment and a trailing one
  // only from the last (decision 0056's Context, measured against this code).
  const trimmed = arg.trim();
  if (trimmed === "" || trimmed === "/" || trimmed === ROOT_ID) return { kind: "root" };
  if (looksLikeId(trimmed)) return { kind: "id", id: trimmed };
  if (trimmed.startsWith(DRIVE_PREFIX)) {
    return { kind: "drive", rest: trimmed.slice(DRIVE_PREFIX.length) };
  }
  return { kind: "path", segments: trimmed.split("/").filter((s) => s !== "") };
}

interface Start {
  parentId: string;
  segments: string[];
  /** Prefix for error messages, so a `drive:` path reports what was typed. */
  label: string;
  /** A My Drive walk earns the "did you mean a shared drive?" hint. */
  hintable: boolean;
}

/**
 * Splits `drive:<name>/<segments>` into its drive root and the rest, resolving
 * the name through the same lookup `--drive` uses (decision 0019 §2).
 */
async function startFromDrive(client: DriveClient, rest: string): Promise<Start> {
  // The name is the first segment *unfiltered*: `drive:/2026` names no drive,
  // it does not name the drive `2026`.
  const [name = "", ...tail] = rest.split("/");
  const segments = tail.filter((s) => s !== "");
  if (name === "") {
    throw new AppError(
      "INVALID_ARGS",
      `"${DRIVE_PREFIX}" needs a shared drive name, e.g. ${DRIVE_PREFIX}Finance/2026. See \`gdrive drives\`.`,
    );
  }
  const drive = await resolveDriveByName(client, name);
  return { parentId: drive.id, segments, label: `${DRIVE_PREFIX}${name}`, hintable: false };
}

/**
 * A path that misses on its *first* segment is often a shared drive spelled as
 * a My Drive folder, so say so. Runs only after the real lookup failed, and
 * never replaces the caller's error when the drive lookup fails in turn.
 */
async function sharedDriveHint(client: DriveClient, name: string, path: string): Promise<string> {
  try {
    const drives = await listSharedDrives(client);
    if (!drives.some((d) => d.name === name)) return "";
    return `. A shared drive has that name — did you mean "${DRIVE_PREFIX}${path}"?`;
  } catch {
    return "";
  }
}

/** What a walk learned about the file an argument names. */
interface Walked {
  /** The file the argument names — a terminal shortcut is *not* followed here. */
  id: string;
  /**
   * The listing entry for the last segment, or null when the id came from the
   * argument itself (an ID passthrough or a root), where nothing was looked up.
   */
  candidate: Candidate | null;
}

/**
 * The shared walk behind {@link resolvePath} and {@link resolveTarget}
 * (decision 0025 §3). Intermediate segments always follow a shortcut — they
 * play the container role, "look inside this" — while the last one is returned
 * as it stands, leaving the two entry points to differ only in what they do
 * with it.
 */
async function walk(client: DriveClient, arg: string): Promise<Walked> {
  const reading = readArgument(arg);
  if (reading.kind === "root") return { id: ROOT_ID, candidate: null };
  if (reading.kind === "id") return { id: reading.id, candidate: null };

  const start: Start =
    reading.kind === "drive"
      ? await startFromDrive(client, reading.rest)
      : { parentId: ROOT_ID, segments: reading.segments, label: "", hintable: true };

  let { parentId } = start;
  let last: Candidate | null = null;
  const walked: string[] = [];

  for (const segment of start.segments) {
    const matches = await childrenNamed(client, parentId, segment);
    const path = [...walked, segment].join("/");
    const soFar = start.label === "" ? path : `${start.label}/${path}`;
    if (matches.length === 0) {
      // The hint has to quote the *normalized* segments, not the raw argument:
      // "/Finance/2026" would otherwise suggest "drive:/Finance/2026", whose
      // empty drive name is INVALID_ARGS.
      const hint =
        start.hintable && walked.length === 0
          ? await sharedDriveHint(client, segment, start.segments.join("/"))
          : "";
      throw new AppError("NOT_FOUND", `No such file or folder: ${soFar}${hint}`);
    }
    if (matches.length > 1) {
      const ids = matches.map((m) => m.id).join(", ");
      throw new AppError(
        "INVALID_ARGS",
        `Ambiguous path segment "${segment}" in ${soFar}; matches: ${ids}. Use a file ID to disambiguate.`,
      );
    }
    const [match] = matches;
    if (match === undefined) {
      throw new AppError("NOT_FOUND", `No such file or folder: ${soFar}`);
    }
    last = match;
    // Look *inside* whatever the segment named: a folder shortcut has no
    // children of its own, so the next segment is searched under its target
    // (decision 0025 §1). A shortcut to a non-folder needs no special case —
    // its target has no children either, and the next segment is NOT_FOUND.
    parentId = match.targetId ?? match.id;
    walked.push(segment);
  }

  return { id: last?.id ?? parentId, candidate: last };
}

/**
 * Resolves a `<file>` argument to a Drive file ID (decision 0008):
 * - empty / `/` / `root` → the My Drive root
 * - an ID-looking argument → returned as-is (ID passthrough)
 * - `drive:<name>[/…]` → a shared drive's root, then the walk (decision 0019)
 * - otherwise a `/`-separated path, walked from the My Drive root by name.
 *
 * A segment with multiple matches → `INVALID_ARGS` (listing candidate IDs);
 * a segment with no match → `NOT_FOUND`.
 *
 * A shortcut named by the *last* segment is returned as itself: this is what
 * the container and entry roles of decision 0025 §1 both call, and `rm link`
 * must not reach the target.
 */
export async function resolvePath(client: DriveClient, arg: string): Promise<string> {
  const { id } = await walk(client, arg);
  return id;
}

/** What {@link resolveTarget} answers: the id to act on, and what is known of it. */
export interface ResolvedTarget {
  /** The shortcut's target when the argument named one, else the file itself. */
  id: string;
  /**
   * Metadata for `id`, when resolving had to fetch it anyway — `null` when it
   * did not, so a caller that needs metadata falls back to its own `getFile`
   * rather than paying twice (decision 0025 §4).
   */
  file: DriveFile | null;
}

function danglingTarget(arg: string, targetId: string): AppError {
  return new AppError(
    "NOT_FOUND",
    `Shortcut "${arg}" points at a file that is gone or not accessible (target ${targetId}).`,
  );
}

/**
 * Fetches what a shortcut points at, in the one hop decision 0025 §5 allows.
 * Both failures name the shortcut, so a `NOT_FOUND` never sends the user
 * hunting for an id they can see in `ls` (§6).
 */
async function fetchTarget(
  client: DriveClient,
  arg: string,
  shortcut: { id: string; targetId: string | null },
): Promise<ResolvedTarget> {
  const { targetId } = shortcut;
  if (targetId === null || targetId === "") {
    throw new AppError(
      "API_ERROR",
      `Drive reports ${shortcut.id} as a shortcut but names no target (from "${arg}").`,
    );
  }

  let target: DriveFile;
  try {
    target = await getFile(client, targetId);
  } catch (error) {
    // Drive answers 404 both for a deleted file and for one this account
    // cannot see; 0025 §6 gives them the same message.
    if (error instanceof AppError && error.code === "NOT_FOUND")
      throw danglingTarget(arg, targetId);
    throw error;
  }
  if (target.trashed) throw danglingTarget(arg, targetId);
  if (target.type === "shortcut") {
    throw new AppError(
      "API_ERROR",
      `Shortcut "${arg}" points at another shortcut (target ${targetId}); Drive does not create those.`,
    );
  }
  return { id: targetId, file: target };
}

/**
 * Resolves a `<file>` argument the way the container and content roles of
 * decision 0025 §1 need it: the same walk as {@link resolvePath}, then one hop
 * through a shortcut named by the argument itself.
 *
 * Nothing in an id-shaped argument says "shortcut", so that form costs one
 * `files.get` — which is why the result carries the metadata it fetched
 * (decision 0025 §4).
 */
export async function resolveTarget(client: DriveClient, arg: string): Promise<ResolvedTarget> {
  const { id, candidate } = await walk(client, arg);

  if (candidate !== null) {
    if (!candidate.isShortcut) return { id, file: null };
    return fetchTarget(client, arg, candidate);
  }

  // A root is a folder by construction, so it is the one id worth not asking about.
  if (id === ROOT_ID || SHARED_DRIVE_ROOT_ID.test(id)) return { id, file: null };

  const file = await getFile(client, id);
  if (file.type !== "shortcut") return { id, file };
  return fetchTarget(client, arg, { id, targetId: file.target_id });
}

/** {@link resolveTarget} for the callers that only need the id (every registry). */
export async function resolveTargetId(client: DriveClient, arg: string): Promise<string> {
  const { id } = await resolveTarget(client, arg);
  return id;
}
