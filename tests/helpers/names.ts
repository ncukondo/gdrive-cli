/**
 * Every way decision 0056 §2 says a path can lose a name, in one list.
 *
 * Each command that gives a file a name runs its own "refused, and nothing was
 * written" case over this, rather than over a subset it chose — a command wired
 * to a narrower check than its neighbours is the shape of defect 0055 and 0056
 * were both written after, and a per-file list is how it would come back.
 *
 * What each spelling *means* is `src/lib/names.test.ts`'s subject, where it is
 * measured against the resolver. Here it is only the input set.
 */
export const UNPATHABLE_NAMES = [
  "Notes ",
  " Notes",
  "a/b",
  "root",
  "1AbCdEfGhIjKlMnOpQrSt",
  "drive:Finance",
];
