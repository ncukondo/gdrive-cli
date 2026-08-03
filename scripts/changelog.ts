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

/**
 * Any second-level heading ends a section, whether or not it names a version.
 * The `{0,3}` is CommonMark's, and it is not decoration: without it an
 * accidentally indented heading is content, and the section above it publishes
 * with the next section inside it while the indented version becomes untaggable.
 */
const SECTION_BREAK = /^ {0,3}##\s/;

/**
 * Deliberately exact, and matched against the trimmed line so that indentation
 * is a Markdown detail rather than drift. A heading that drifted — `## v0.8.0`,
 * `## [0.8.0]`, a hyphen for the em dash, a missing date — matches
 * `SECTION_BREAK` but not this, so it still ends the section above it and starts
 * none of its own. Drift therefore fails the same way a missing version does,
 * which is the point: both mean "the notes for this release are not where they
 * were promised".
 */
const VERSION_HEADING = /^## (\S+) — \d{4}-\d{2}-\d{2}$/;

/** An opening or closing code fence: the run of markers, then the rest of the line. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * A stretch of lines in which a `## ` is content rather than a heading. Both
 * kinds behave the same way for this file's purposes, and both are refused when
 * one is still open where a heading would have started.
 */
interface HiddenRegion {
  kind: "code fence" | "HTML comment";
  /** 1-based line the region opened on, so an error can point at it. */
  line: number;
  /** The fence marker run; empty for a comment. */
  marker: string;
}

interface ScannedLine {
  text: string;
  /** True for a `## ` line that is really a heading, version or not. */
  isSectionBreak: boolean;
  /** The version this line's heading names, or null when it names none. */
  version: string | null;
}

/** Whether an HTML comment is open once `line` has been read. */
function commentOpenAfter(line: string, open: boolean): boolean {
  let at = 0;
  while (at < line.length) {
    if (open) {
      const end = line.indexOf("-->", at);
      if (end === -1) return true;
      open = false;
      at = end + 3;
    } else {
      const start = line.indexOf("<!--", at);
      if (start === -1) return false;
      open = true;
      at = start + 4;
    }
  }
  return open;
}

/** The region `text` opens, or null when it opens none. */
function opensRegion(text: string, line: number): HiddenRegion | null {
  const edge = FENCE.exec(text);
  const marker = edge?.[1] ?? "";
  const rest = edge?.[2] ?? "";
  // CommonMark: a backtick fence's info string may not contain a backtick, so
  // a paragraph beginning ```a`b is not a fence. A changelog quotes fence
  // syntax more often than most documents, and refusing one would fail the
  // release job on a valid file.
  if (edge !== null && !(marker.startsWith("`") && rest.includes("`"))) {
    return { kind: "code fence", line, marker };
  }
  if (commentOpenAfter(text, false)) return { kind: "HTML comment", line, marker: "" };
  return null;
}

/** The region still open once `text` has been read, or null once it closes. */
function stillOpen(region: HiddenRegion, text: string): HiddenRegion | null {
  if (region.kind === "HTML comment") return commentOpenAfter(text, true) ? region : null;
  const edge = FENCE.exec(text);
  const marker = edge?.[1] ?? "";
  const rest = edge?.[2] ?? "";
  // A closing fence is the same character, at least as long, and alone on its
  // line; anything else is content, including a nested opening fence.
  const closes =
    edge !== null &&
    marker[0] === region.marker[0] &&
    marker.length >= region.marker.length &&
    rest.trim() === "";
  return closes ? null : region;
}

/**
 * Splits the document into lines that know whether they are structure or
 * content. Hidden regions are the whole reason this is not a regex applied to
 * each line on its own: a changelog documents its own heading format, and an
 * example inside a fence must neither end a section nor start one.
 *
 * The refusal is one rule with two trigger points: a *version* heading may not
 * be hidden inside a region, and a region may not be open at the end of the
 * file. Both say the same thing — a region that swallows a declaration, or that
 * never ends, publishes one version's notes with everything below it inside —
 * and whether a later fence marker happens to close the region is an accident
 * of the document rather than a difference worth honouring.
 *
 * The rule is keyed on a well-formed version heading rather than on any `## `
 * line, and that line is where the two directions meet. A fenced
 * `## Not a version heading` is an ordinary illustration and stays content; a
 * fenced `## 0.8.0 — 2026-08-03` is indistinguishable from a fence somebody
 * forgot to close, and those have opposite consequences. An example is written
 * with a placeholder, which is what this file's own preamble does.
 */
function scan(changelog: string, source: string): ScannedLine[] {
  const lines: ScannedLine[] = [];
  const declaredAt = new Map<string, number>();
  let region: HiddenRegion | null = null;

  // Normalising the line ending here is what keeps a CRLF changelog from
  // putting a stray carriage return on every line of the release body.
  const raw = changelog.split(/\r?\n/);
  for (const [index, text] of raw.entries()) {
    const line = index + 1;

    if (region !== null) {
      if (versionNamedBy(text) !== null) throw hidesDeclaration(source, region, line, text);
      region = stillOpen(region, text);
      lines.push({ text, isSectionBreak: false, version: null });
      continue;
    }

    const opened = opensRegion(text, line);
    if (SECTION_BREAK.test(text)) {
      const version = versionNamedBy(text);
      if (version !== null) {
        const first = declaredAt.get(version);
        if (first !== undefined) throw declaredTwice(source, version, first, line);
        declaredAt.set(version, line);
      }
      // A heading line can still trail an unclosed `<!--`.
      region = opened;
      lines.push({ text, isSectionBreak: true, version });
      continue;
    }
    region = opened;
    lines.push({ text, isSectionBreak: false, version: null });
  }

  if (region !== null) throw neverClosed(source, region);
  return lines;
}

/** The version a line declares, or null when the line is not a version heading. */
function versionNamedBy(text: string): string | null {
  if (!SECTION_BREAK.test(text)) return null;
  return VERSION_HEADING.exec(text.trim())?.[1] ?? null;
}

function hidesDeclaration(
  source: string,
  region: HiddenRegion,
  line: number,
  heading: string,
): Error {
  return new Error(
    `${source}: line ${line} reads as the version heading "${heading.trim()}", but ` +
      `it is inside the ${region.kind} opened on line ${region.line}, so it declares ` +
      `nothing.\n` +
      `That is how a ${region.kind} nobody closed publishes one version's notes with ` +
      `every section below it inside. If the line is deliberately an example, write ` +
      `the version as a placeholder — "${HEADING_FORMAT}" — so it cannot be read as ` +
      `a declaration.`,
  );
}

function neverClosed(source: string, region: HiddenRegion): Error {
  return new Error(
    `${source}: the ${region.kind} opened on line ${region.line} is never closed, ` +
      `so a release body would end in the middle of it and swallow the notes ` +
      `GitHub appends below. Close the ${region.kind}.`,
  );
}

function declaredTwice(source: string, version: string, first: number, second: number): Error {
  return new Error(
    `${source} declares ${version} twice, on line ${first} and line ${second}.\n` +
      `Only the first would be published, so which notes a release carries would ` +
      `depend on which heading a merge happened to put first. Keep one section ` +
      `per version.`,
  );
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
