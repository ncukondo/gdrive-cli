import { AppError, errorToCode, type ErrorData } from "../types/index.ts";
import { formatValues, line } from "./output.ts";

/**
 * Everything a `create` does once the file exists — the half where a failure
 * leaves something behind.
 *
 * `documents.create`, `spreadsheets.create`, `forms.create` and
 * `presentations.create` all take a title and ignore a parent (decision 0028
 * §7), so every one of them makes a file in My Drive's root and then has two
 * things left to do: move it where the caller asked, and fill it. This runs
 * those in that order and attaches the file to whatever fails, which is the
 * pair of guarantees [#36](https://github.com/ncukondo/gdrive-cli/issues/36)
 * asked for: the file is inside `--parent` before anything can fail on it, and
 * a caller that never got a success envelope still learns the id.
 *
 * It lives here rather than in one of the four commands because all four have
 * the shape, and because what a stopped `create` reports is worth testing
 * without a command around it — which is `copy-tree.ts`'s reason too.
 */

/** The file a create just made: its id, and the name Drive knows it by. */
export interface NewFile {
  id: string;
  title: string;
}

export interface Placement {
  /** Where `--parent` resolved to, or `undefined` when it was not given. */
  parentId: string | undefined;
  /** Drive move — no create API in this CLI accepts a parent. */
  moveFile: (fileId: string, parentId: string) => Promise<unknown>;
}

/**
 * What a failed `create` reports beside its message (decision 0031 §4).
 *
 * `parent_id` describes where the file **is**, not where it was asked to go, so
 * it is absent when the move is the call that failed. A caller reading it as
 * "where to look for the thing I have to clean up" is then right in every case,
 * and its absence means My Drive's root.
 *
 * The payload is the success envelope's `data` for the same command, minus what
 * the run never got to: a consumer reads `data.id` off either answer.
 */
function leftBehind(created: NewFile, requested: string | undefined, placedIn?: string): ErrorData {
  const where =
    placedIn !== undefined
      ? line`in ${placedIn}, where it was asked to go`
      : requested === undefined
        ? "in My Drive"
        : line`in My Drive: the move into ${requested} is what failed`;
  return {
    payload: {
      id: created.id,
      title: created.title,
      ...(placedIn !== undefined ? { parent_id: placedIn } : {}),
    },
    text: line`Created ${created.title} (${created.id}) and left it ${where}. Remove it with: gdrive rm ${created.id}`,
    quiet: formatValues([created.id]),
  };
}

/**
 * Puts `created` where `placement` says, then runs `fill`, and answers whatever
 * `fill` answered.
 *
 * The move goes first because it is the only step that changes *where* a
 * failure leaves the file, and every other step can fail: a `batchUpdate` is
 * atomic, so one item the API refuses takes the whole fill down after the file
 * exists. Moving first keeps that file inside the folder the caller named
 * rather than loose in My Drive's root, which for the live suite is the
 * difference between a write inside its sandbox and one outside every sandbox
 * (decision 0043 §2).
 *
 * Whatever fails is re-thrown carrying {@link leftBehind}, whatever class it
 * arrived as — a dropped socket is a plain `Error` and a bug in this program is
 * a `TypeError`, and requiring an `AppError` would throw the id away for the
 * failures least likely to have been anticipated. `errorToCode` decides the
 * code, so it is the one `handleError` would have derived from the original.
 */
export async function afterCreate<T>(
  created: NewFile,
  placement: Placement,
  fill: () => Promise<T>,
): Promise<T> {
  const { parentId, moveFile } = placement;
  let placedIn: string | undefined;
  try {
    if (parentId !== undefined) {
      await moveFile(created.id, parentId);
      placedIn = parentId;
    }
    return await fill();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError(errorToCode(error), message, {
      data: leftBehind(created, parentId, placedIn),
    });
  }
}
