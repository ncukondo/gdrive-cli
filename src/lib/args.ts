import { AppError } from "../types/index.ts";

/**
 * Narrows a CLI string to a member of a closed set (decision 0015). `find`
 * returns `T | undefined`, so the narrowing is the compiler's, not ours.
 * A miss throws `INVALID_ARGS` naming the flag and the accepted values.
 */
export function parseChoice<T extends string>(
  values: readonly T[],
  value: string,
  flag: string,
): T {
  const match = values.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new AppError("INVALID_ARGS", `Invalid ${flag} "${value}". Use: ${values.join(", ")}.`);
  }
  return match;
}
