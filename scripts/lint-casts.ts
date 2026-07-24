#!/usr/bin/env bun
/**
 * Fails when a type assertion re-enters the codebase (decision 0015).
 * `oxlint` has no rule for this, so this is the guard CI runs next to
 * `typecheck`.
 *
 * Reported: `as T` (any form, including `as unknown as T`), a prefix
 * `<T>expr` assertion, and the non-null `!`. Allowed: `as const`, `satisfies`,
 * `import { x as y }`, and any line carrying an `// assertion:` comment
 * explaining why it has to stay.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "tests", "scripts"];
const ALLOW_MARKER = "// assertion:";

interface Finding {
  file: string;
  line: number;
  text: string;
  reason: string;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

/** Blanks out comments and string/template literals so prose never matches. */
function stripNoise(source: string): string[] {
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

const RULES: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bas\s+(?!const\b)[A-Za-z_$({[]/, reason: "`as` type assertion" },
  { pattern: /[=(,:[]\s*<[A-Za-z_$][\w$]*>\s*[\w($[]/, reason: "`<T>expr` type assertion" },
  { pattern: /[\w)\]]!\s*[.[(]/, reason: "non-null `!` assertion" },
];

const findings: Finding[] = [];

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const raw = readFileSync(file, "utf8").split("\n");
    const code = stripNoise(readFileSync(file, "utf8"));
    code.forEach((line, index) => {
      const original = raw[index] ?? "";
      if (original.includes(ALLOW_MARKER)) return;
      // `import { parse as parseToml }` and `export { x as y }` are renames.
      if (/^\s*(import|export)\b/.test(line) || /^\s*\}\s*from\b/.test(line)) return;
      for (const rule of RULES) {
        if (rule.pattern.test(line)) {
          findings.push({ file, line: index + 1, text: original.trim(), reason: rule.reason });
          break;
        }
      }
    });
  }
}

if (findings.length > 0) {
  process.stderr.write(
    `Found ${findings.length} type assertion(s) — see decisions/0015-no-type-assertions.md.\n` +
      `Parse the value, narrow it, or fix the type. If one must stay, justify it\n` +
      `on the same line with "${ALLOW_MARKER} <reason>".\n\n`,
  );
  for (const f of findings) {
    process.stderr.write(`  ${f.file}:${f.line}  ${f.reason}\n    ${f.text}\n`);
  }
  process.exit(1);
}

process.stdout.write(`No type assertions in ${ROOTS.join(", ")}.\n`);
