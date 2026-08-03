#!/usr/bin/env bun
/**
 * Extracts one version's section from `CHANGELOG.md`, so the release workflow
 * can pass it to `gh release create --notes-file`.
 *
 * Decision 0014 permits breaking changes in a 0.x minor release on condition
 * that they are "called out in the release notes for the version that ships
 * it", which makes the changelog the compatibility record rather than a
 * convenience. So every failure here is loud: a tag whose version has no
 * section, a heading that drifted, an empty section and an unclosed code fence
 * all fail the release job. The failure worth preventing is not a crash — it is
 * a plausible-looking body that is the wrong text.
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

/** An opening or closing code fence: the run of markers, then the rest of the line. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

interface ScannedLine {
  text: string;
  /** True for a `## ` line outside a fence, whether or not it names a version. */
  isSectionBreak: boolean;
  /** The version this line's heading names, or null when it names none. */
  version: string | null;
}

/**
 * Splits the document into lines that know whether they are structure or
 * content. Fences are the whole reason this is not a regex applied to each line
 * on its own: a changelog documents its own heading format, and an example
 * inside a fence must neither end a section nor start one. Without this, a
 * fenced `## 0.9.0 …` above the real heading makes the extractor return the
 * fence as the entire release body, and exit 0 while doing it.
 */
function scan(changelog: string, source: string): ScannedLine[] {
  const lines: ScannedLine[] = [];
  let fence: string | null = null;

  // Normalising the line ending here is what keeps a CRLF changelog from
  // putting a stray carriage return on every line of the release body.
  for (const text of changelog.split(/\r?\n/)) {
    const edge = FENCE.exec(text);
    const marker = edge?.[1] ?? "";
    const rest = edge?.[2] ?? "";
    const closesFence =
      fence !== null &&
      marker[0] === fence[0] &&
      marker.length >= fence.length &&
      rest.trim() === "";

    if (fence !== null) {
      // A closing fence is the same character, at least as long, and alone on
      // its line; anything else is content, including a nested opening fence.
      if (closesFence) fence = null;
      lines.push({ text, isSectionBreak: false, version: null });
      continue;
    }
    if (edge !== null) {
      fence = marker;
      lines.push({ text, isSectionBreak: false, version: null });
      continue;
    }
    if (SECTION_BREAK.test(text)) {
      const heading = VERSION_HEADING.exec(text.trimEnd());
      lines.push({ text, isSectionBreak: true, version: heading?.[1] ?? null });
      continue;
    }
    lines.push({ text, isSectionBreak: false, version: null });
  }

  if (fence !== null) {
    throw new Error(
      `${source} has a code fence that is never closed, so every heading below it ` +
        `is invisible and a section would be extracted with the rest of the file ` +
        `inside it. Close the fence.`,
    );
  }
  return lines;
}

/**
 * Every version the changelog declares, in the order they appear. A fenced
 * example is not a declaration and is not listed, which is what makes this safe
 * to name in the error a release failed on.
 */
export function listVersions(changelog: string, source = "CHANGELOG.md"): string[] {
  const versions: string[] = [];
  for (const line of scan(changelog, source)) {
    if (line.version !== null) versions.push(line.version);
  }
  return versions;
}

function fail(changelog: string, version: string, source: string, problem: string): Error {
  const known = listVersions(changelog, source);
  return new Error(
    `${problem}\n` +
      `Add one to ${source} under a heading of exactly "${HEADING_FORMAT}", ` +
      `here "## ${version} — YYYY-MM-DD".\n` +
      `A heading that drifted from that format reads as a missing version, ` +
      `because nothing else can tell the two apart.\n` +
      `Sections found: ${known.length > 0 ? known.join(", ") : "(none)"}.`,
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
 * {@link HEADING_FORMAT}, and when it is present but empty.
 */
export function extractVersionNotes(
  changelog: string,
  version: string,
  source = "CHANGELOG.md",
): string {
  const body: string[] = [];
  let inSection = false;
  let found = false;

  for (const line of scan(changelog, source)) {
    if (line.isSectionBreak) {
      if (inSection) break;
      inSection = line.version === version;
      found = found || inSection;
      continue;
    }
    if (inSection) body.push(line.text);
  }

  if (!found) throw fail(changelog, version, source, `${source} has no section for ${version}.`);

  const notes = trimBlankLines(body);
  if (notes.length === 0) {
    throw fail(changelog, version, source, `The ${version} section of ${source} is empty.`);
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
