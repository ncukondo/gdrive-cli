import { AppError } from "../types/index.ts";
import {
  escapeQueryValue,
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

interface Candidate {
  id: string;
  name: string;
  /** True when this entry is a pointer rather than a file (decision 0025). */
  isShortcut: boolean;
  /** `shortcutDetails.targetId`, or null on anything that is not a shortcut. */
  targetId: string | null;
}

async function childrenNamed(
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
  const trimmed = arg.trim();
  if (trimmed === "" || trimmed === "/" || trimmed === ROOT_ID) {
    return { id: ROOT_ID, candidate: null };
  }
  if (looksLikeId(trimmed)) {
    return { id: trimmed, candidate: null };
  }

  const start: Start = trimmed.startsWith(DRIVE_PREFIX)
    ? await startFromDrive(client, trimmed.slice(DRIVE_PREFIX.length))
    : {
        parentId: ROOT_ID,
        segments: trimmed.split("/").filter((s) => s !== ""),
        label: "",
        hintable: true,
      };

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
