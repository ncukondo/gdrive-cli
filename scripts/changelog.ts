#!/usr/bin/env bun
/**
 * Extracts one version's section from `CHANGELOG.md`, so the release workflow
 * can pass it to `gh release create --notes-file`.
 *
 * Decision 0014 permits breaking changes in a 0.x minor release on condition
 * that they are "called out in the release notes for the version that ships
 * it", which makes the changelog the compatibility record rather than a
 * convenience. So every failure here is loud: a tag whose version has no
 * section must fail the release job rather than publish an empty body that
 * nobody can read.
 *
 * Usage: `bun scripts/changelog.ts <version> [changelog path]` — the section
 * goes to stdout, and anything wrong goes to stderr with a non-zero exit.
 */
import { readFileSync } from "node:fs";

/** The shape a version heading must have, quoted in the error when none matches. */
export const HEADING_FORMAT = "## <version> — <YYYY-MM-DD>";

/** Any second-level heading ends a section, whether or not it names a version. */
const SECTION_BREAK = /^##\s/;

/**
 * Deliberately exact. A heading that drifted — `## v0.8.0`, `## [0.8.0]`, a
 * hyphen for the em dash, a missing date — matches `SECTION_BREAK` but not
 * this, so it still ends the section above it and starts none of its own.
 * Drift therefore fails the same way a missing version does, which is the
 * point: both mean "the notes for this release are not where they were
 * promised".
 */
const VERSION_HEADING = /^## (\S+) — \d{4}-\d{2}-\d{2}$/;

function fail(version: string, source: string, problem: string): Error {
  return new Error(
    `${problem}\n` +
      `Add one to ${source} under a heading of exactly "${HEADING_FORMAT}", ` +
      `here "## ${version} — YYYY-MM-DD".\n` +
      `A heading that drifted from that format reads as a missing version, ` +
      `because nothing else can tell the two apart.`,
  );
}

/** Drops the blank lines a Markdown section carries at either end. */
function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? "").trim() === "") start++;
  while (end > start && (lines[end - 1] ?? "").trim() === "") end--;
  return lines.slice(start, end);
}

/**
 * The body of `version`'s section: everything between its heading and the next
 * second-level heading, with the heading itself and the surrounding blank lines
 * removed. `source` only names the file in errors.
 *
 * Throws when the section is absent, when its heading does not match
 * {@link HEADING_FORMAT}, or when it is present but empty.
 */
export function extractVersionNotes(
  changelog: string,
  version: string,
  source = "CHANGELOG.md",
): string {
  const body: string[] = [];
  let inSection = false;
  let found = false;

  for (const line of changelog.split("\n")) {
    if (SECTION_BREAK.test(line)) {
      if (inSection) break;
      const heading = VERSION_HEADING.exec(line.trimEnd());
      inSection = heading !== null && heading[1] === version;
      found = found || inSection;
      continue;
    }
    if (inSection) body.push(line);
  }

  if (!found) throw fail(version, source, `${source} has no section for ${version}.`);

  const notes = trimBlankLines(body);
  if (notes.length === 0) {
    throw fail(version, source, `The ${version} section of ${source} is empty.`);
  }
  return notes.join("\n");
}

if (import.meta.main) {
  const [version, path = "CHANGELOG.md"] = process.argv.slice(2);
  if (version === undefined || version === "") {
    process.stderr.write("usage: bun scripts/changelog.ts <version> [changelog path]\n");
    process.exit(2);
  }
  try {
    process.stdout.write(`${extractVersionNotes(readFileSync(path, "utf8"), version, path)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
