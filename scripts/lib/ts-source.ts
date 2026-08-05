/**
 * Blanks out comments and string/template literals in TypeScript source, so a
 * scanner looking for a construct never matches the same word written in prose.
 *
 * Extracted from `scripts/lint-casts.ts`, which needed it first, once
 * `scripts/lint-widths.ts` needed the same thing. The alternative — a second
 * copy — is the duplication `decisions/0047` was written about.
 *
 * This is a blanker, not a parser: it returns one entry per input line with the
 * noise removed and the code kept, and every guard that uses it reports against
 * the *original* line so a reader sees what they wrote.
 */

/** One line of `source` with comments and literals blanked out, in order. */
export function stripNoise(source: string): string[] {
  const lines = source.split("\n");
  let inBlockComment = false;

  return lines.map((line) => {
    let out = "";
    let quote: string | undefined;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const next = line[i + 1];

      if (inBlockComment) {
        if (char === "*" && next === "/") {
          inBlockComment = false;
          i++;
        }
        continue;
      }
      if (quote !== undefined) {
        if (char === "\\") i++;
        else if (char === quote) quote = undefined;
        continue;
      }
      if (char === "/" && next === "*") {
        inBlockComment = true;
        i++;
        continue;
      }
      if (char === "/" && next === "/") break;
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        continue;
      }
      out += char;
    }
    return out;
  });
}
