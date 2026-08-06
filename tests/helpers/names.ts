/**
 * The names decision 0056 §2 says a path loses, split by *where* it loses them.
 *
 * Each command that gives a file a name runs both lists: the first against its
 * ordinary destination, the second against a drive root — and the second again
 * against an ordinary destination, to check it is **accepted** there. A command
 * wired to a narrower check than its neighbours, or to a wider one, is the shape
 * of defect this rule has now been redrawn for twice; a per-file list is how it
 * would come back.
 *
 * What each spelling *means* is `src/lib/names.test.ts`'s subject, where every
 * row is measured against the resolver in both places. Here they are only inputs.
 */

/** Lost wherever the file sits: the trailing trim, the separator, no name at all. */
export const UNPATHABLE_ANYWHERE = ["Notes ", "a/b", "  "];

/**
 * Lost only where the name is the whole path argument — at a drive root. Put one
 * segment in front of any of these and the resolver finds the file, so a command
 * that refuses them in a subfolder is refusing something that works.
 */
export const UNPATHABLE_AT_A_DRIVE_ROOT = [
  " Notes",
  "root",
  "1AbCdEfGhIjKlMnOpQrSt",
  "0ABCDEFGHIJKLMNOPQR",
  "Meeting_notes_2026_08",
  "drive:Finance",
];

/** The My Drive root alias, which every `--parent`-less command lands in. */
export const A_DRIVE_ROOT = "root";
