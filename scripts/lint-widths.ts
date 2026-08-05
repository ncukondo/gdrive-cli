#!/usr/bin/env bun
/**
 * Fails when anything starts computing how wide a string draws (decision 0036
 * §3: "No renderer computes a display width, and none should be added").
 *
 * The rule is unusual in that the code it forbids is not wrong-looking. A
 * `padEnd` is the obvious way to line a column up, and 0036 was written because
 * no oracle for "how wide does this draw?" can be trusted across versions and
 * terminals. The measured case is `🟰` U+1F7F0, where `string-width@5.1.2` says
 * one column and both Unicode Annex #11 and `Bun.stringWidth` say two — a
 * disagreement inside one dependency tree ([0039](../decisions/0039-what-0036-and-0037-got-wrong.md)
 * §1, which corrected 0036's own example after measuring it; do not restate that
 * example from 0036's `Context`). A column computed from a wrong answer is a
 * column that does not line up, and for a machine reader that is the id running
 * into the name.
 *
 * So this guard is not protecting an invariant the type system could hold. It is
 * there so the next person reaching for the obvious tool meets the reason first.
 *
 * What it does *not* cover is worth stating, because the header would otherwise
 * imply it: this matches identifiers, so a hand-rolled width table like the one
 * pull request #14 built, or `" ".repeat(width - len)`, passes. 0036 §3 forbids
 * those too. The guard is the cheap half of the rule; the expensive half is
 * still a reader.
 *
 * Usage: `bun scripts/lint-widths.ts` — scans `src/` and `scripts/`, skipping
 * tests, and exits 1 with the offending lines.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripNoise } from "./lib/ts-source.js";

const ROOTS = ["src", "scripts"];

/**
 * Identifiers that only appear when something is measuring. `stringWidth`
 * covers `Bun.stringWidth` and any import of `string-width`, both of which 0036
 * measured and found disagreeing.
 */
const CALLS = ["padEnd", "padStart", "stringWidth"] as const;

/**
 * Packages whose whole purpose is a width table. These are matched against the
 * raw line rather than the stripped one, because a module name lives inside a
 * string literal and {@link stripNoise} blanks it out — the one place where
 * looking at code alone would miss the thing being banned.
 */
const PACKAGES = ["eastasianwidth", "string-width", "wcwidth"] as const;

const IMPORTS_PACKAGE = (name: string) =>
  new RegExp(String.raw`(from|require\s*\(\s*)\s*["']${name}["']`);

export interface WidthFinding {
  file: string;
  /** 1-based, so it pairs with an editor. */
  line: number;
  /** The original line, comment and all, so a reader sees what they wrote. */
  text: string;
  identifier: string;
}

export interface SourceFile {
  path: string;
  source: string;
}

/** Every width computation in `files`, in file then line order. */
export function findWidthCalls(files: SourceFile[]): WidthFinding[] {
  const findings: WidthFinding[] = [];

  for (const { path, source } of files) {
    const raw = source.split("\n");
    const code = stripNoise(source);

    code.forEach((line, index) => {
      const original = raw[index] ?? "";

      for (const call of CALLS) {
        if (new RegExp(String.raw`\b${call}\b`).test(line)) {
          findings.push({ file: path, line: index + 1, text: original.trim(), identifier: call });
          return;
        }
      }
      for (const name of PACKAGES) {
        if (IMPORTS_PACKAGE(name).test(original)) {
          findings.push({ file: path, line: index + 1, text: original.trim(), identifier: name });
          return;
        }
      }
    });
  }

  return findings;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

if (import.meta.main) {
  const files = ROOTS.flatMap((root) =>
    walk(root).map((path) => ({ path, source: readFileSync(path, "utf8") })),
  );
  const findings = findWidthCalls(files);

  if (findings.length > 0) {
    process.stderr.write(
      `Found ${findings.length} display-width computation(s) — see ` +
        `decisions/0036-machine-format-by-default.md §3.\n` +
        `Nothing knows how wide a string draws, so a column computed from one is a\n` +
        `column that does not line up, and for a machine reader that is the id\n` +
        `running into the name. Separate fields with a tab and pad nothing; a\n` +
        `person who wants columns pipes the output through a formatter that has a\n` +
        `font and a terminal in front of it.\n\n`,
    );
    for (const f of findings) {
      process.stderr.write(`  ${f.file}:${f.line}  ${f.identifier}\n    ${f.text}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(`No display-width computation in ${ROOTS.join(", ")}.\n`);
}
