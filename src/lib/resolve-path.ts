import { AppError } from "../types/index.ts";
import { escapeQueryValue, mapDriveError, normalizeFile, type DriveClient } from "./api.ts";

/** The alias Drive accepts for the My Drive root folder. */
export const ROOT_ID = "root";

/**
 * Heuristic for "this argument is a Drive file ID, not a path". Drive IDs are
 * long, slash-free, `[A-Za-z0-9_-]` strings; folder names are typically shorter
 * and/or contain spaces. Per decision 0008 an ID-looking argument wins.
 */
export function looksLikeId(arg: string): boolean {
  return /^[A-Za-z0-9_-]{20,}$/.test(arg);
}

interface Candidate {
  id: string;
  name: string;
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
    const res = await client.files.list({ q, pageSize: 100, fields: "files(id,name,mimeType)" });
    return (res.data.files ?? []).map((raw) => {
      const f = normalizeFile(raw);
      return { id: f.id, name: f.name };
    });
  } catch (error) {
    mapDriveError(error);
  }
}

/**
 * Resolves a `<file>` argument to a Drive file ID (decision 0008):
 * - empty / `/` / `root` → the My Drive root
 * - an ID-looking argument → returned as-is (ID passthrough)
 * - otherwise a `/`-separated path, walked from root by name.
 *
 * A segment with multiple matches → `INVALID_ARGS` (listing candidate IDs);
 * a segment with no match → `NOT_FOUND`.
 */
export async function resolvePath(client: DriveClient, arg: string): Promise<string> {
  const trimmed = arg.trim();
  if (trimmed === "" || trimmed === "/" || trimmed === ROOT_ID) {
    return ROOT_ID;
  }
  if (looksLikeId(trimmed)) {
    return trimmed;
  }

  const segments = trimmed.split("/").filter((s) => s !== "");
  let parentId = ROOT_ID;
  const walked: string[] = [];

  for (const segment of segments) {
    const matches = await childrenNamed(client, parentId, segment);
    const soFar = [...walked, segment].join("/");
    if (matches.length === 0) {
      throw new AppError("NOT_FOUND", `No such file or folder: ${soFar}`);
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
    parentId = match.id;
    walked.push(segment);
  }

  return parentId;
}
