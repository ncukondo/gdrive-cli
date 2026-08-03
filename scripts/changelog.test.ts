import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HEADING_FORMAT, extractVersionNotes, listVersions } from "./changelog.ts";

const THREE_VERSIONS = `# Changelog

Preamble that belongs to no version.

## 0.9.0 — 2026-09-01

Newest.

## 0.8.0 — 2026-08-03

### Breaking changes

- \`type\` gains two members.

### Added

- \`forms read\`.

## 0.7.0 — 2026-07-27

Oldest.
`;

describe("extractVersionNotes", () => {
  it("returns one version's body, without its heading or its neighbours", () => {
    const notes = extractVersionNotes(THREE_VERSIONS, "0.8.0");

    expect(notes).toBe(
      [
        "### Breaking changes",
        "",
        "- `type` gains two members.",
        "",
        "### Added",
        "",
        "- `forms read`.",
      ].join("\n"),
    );
  });

  it("keeps the newest and the oldest sections separable too", () => {
    expect(extractVersionNotes(THREE_VERSIONS, "0.9.0")).toBe("Newest.");
    expect(extractVersionNotes(THREE_VERSIONS, "0.7.0")).toBe("Oldest.");
  });

  it("never leaks the preamble above the first version", () => {
    expect(extractVersionNotes(THREE_VERSIONS, "0.9.0")).not.toContain("Preamble");
  });

  it("errors by name on a version that is not there, rather than returning nothing", () => {
    expect(() => extractVersionNotes(THREE_VERSIONS, "0.8.1", "CHANGELOG.md")).toThrowError(
      /0\.8\.1/,
    );
    expect(() => extractVersionNotes(THREE_VERSIONS, "0.8.1", "CHANGELOG.md")).toThrowError(
      /CHANGELOG\.md/,
    );
  });

  it.each([
    ["a `v` prefix", "## v0.8.0 — 2026-08-03"],
    ["a deeper heading level", "### 0.8.0 — 2026-08-03"],
    ["no date", "## 0.8.0"],
    ["a hyphen instead of an em dash", "## 0.8.0 - 2026-08-03"],
    ["a bracketed version", "## [0.8.0] — 2026-08-03"],
  ])("treats a heading that drifted by %s as a missing version, and says so", (_why, heading) => {
    const drifted = `# Changelog\n\n${heading}\n\nThe body is right here.\n`;

    expect(() => extractVersionNotes(drifted, "0.8.0", "CHANGELOG.md")).toThrowError(/0\.8\.0/);
    expect(() => extractVersionNotes(drifted, "0.8.0", "CHANGELOG.md")).toThrowError(
      /CHANGELOG\.md/,
    );
    // The error has to name the shape it wanted, because "no such version" and
    // "the heading moved" are the same symptom.
    expect(() => extractVersionNotes(drifted, "0.8.0", "CHANGELOG.md")).toThrowError(
      new RegExp(HEADING_FORMAT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  it("does not let a drifted heading below the wanted version leak into its body", () => {
    const drifted = `## 0.8.0 — 2026-08-03\n\nMine.\n\n## v0.7.0 — 2026-07-27\n\nNot mine.\n`;

    expect(extractVersionNotes(drifted, "0.8.0")).toBe("Mine.");
  });

  it("errors by name on a section that is present but empty", () => {
    const empty = `## 0.8.0 — 2026-08-03\n\n## 0.7.0 — 2026-07-27\n\nOldest.\n`;

    expect(() => extractVersionNotes(empty, "0.8.0", "CHANGELOG.md")).toThrowError(/0\.8\.0/);
    expect(() => extractVersionNotes(empty, "0.8.0", "CHANGELOG.md")).toThrowError(/empty/i);
  });

  it("keeps a section's own sub-headings, which are not version headings", () => {
    expect(extractVersionNotes(THREE_VERSIONS, "0.8.0")).toContain("### Breaking changes");
  });

  it("reads a CRLF file without leaving a carriage return on every line", () => {
    expect(extractVersionNotes(THREE_VERSIONS.replace(/\n/g, "\r\n"), "0.9.0")).toBe("Newest.");
  });
});

describe("a `##` line inside a fenced code block", () => {
  it("does not truncate the section it sits in", () => {
    const fenced = [
      "## 0.8.0 — 2026-08-03",
      "",
      "Real notes, first line.",
      "",
      "```markdown",
      "## Not a version heading, just an example",
      "```",
      "",
      "Text after the fence.",
      "",
    ].join("\n");

    expect(extractVersionNotes(fenced, "0.8.0")).toContain("Text after the fence.");
  });

  it("does not become the body of the version it illustrates", () => {
    const fenced = [
      "# Changelog",
      "",
      "Here is the format we use:",
      "",
      "```",
      "## <version> — <YYYY-MM-DD>",
      "```",
      "",
      "## 0.9.0 — 2026-09-01",
      "",
      "The real 0.9.0 notes.",
      "",
    ].join("\n");

    expect(extractVersionNotes(fenced, "0.9.0")).toBe("The real 0.9.0 notes.");
  });

  it("refuses a fenced example that is a real version heading, rather than guessing", () => {
    // Indistinguishable from a fence somebody forgot to close, and the two have
    // opposite consequences — so the placeholder above is the supported form.
    const ambiguous = ["```", "## 0.9.0 — 2026-09-01", "```", "", "Tail.", ""].join("\n");

    expect(() => extractVersionNotes(ambiguous, "0.9.0", "CHANGELOG.md")).toThrowError(
      /0\.9\.0 — 2026-09-01/,
    );
    expect(() => extractVersionNotes(ambiguous, "0.9.0", "CHANGELOG.md")).toThrowError(/fence/i);
  });

  it("is skipped inside a `~~~` fence too", () => {
    const fenced = ["## 0.8.0 — 2026-08-03", "", "~~~", "## nope", "~~~", "", "Tail.", ""].join(
      "\n",
    );

    expect(extractVersionNotes(fenced, "0.8.0")).toContain("Tail.");
  });

  it("errors rather than swallowing the rest of the file when a fence never closes", () => {
    const unclosed = [
      "## 0.9.0 — 2026-09-01",
      "",
      "```",
      "an example nobody closed",
      "",
      "## 0.8.0 — 2026-08-03",
      "",
      "Mine.",
      "",
    ].join("\n");

    expect(() => extractVersionNotes(unclosed, "0.9.0", "CHANGELOG.md")).toThrowError(
      /CHANGELOG\.md/,
    );
    expect(() => extractVersionNotes(unclosed, "0.9.0", "CHANGELOG.md")).toThrowError(/fence/i);
  });

  it("errors when a fence closes far enough down to have hidden a heading", () => {
    // The fence is closed, so nothing is missing at EOF — but two whole
    // sections are inside it, and 0.9.0 would publish the rest of the file.
    const swallowing = [
      "## 0.9.0 — 2026-09-01",
      "",
      "Newest.",
      "",
      "```sh",
      "gdrive ls",
      "",
      "## 0.8.0 — 2026-08-03",
      "",
      "Middle.",
      "",
      "```",
      "",
      "Tail.",
      "",
    ].join("\n");

    expect(() => extractVersionNotes(swallowing, "0.9.0", "CHANGELOG.md")).toThrowError(/fence/i);
    expect(() => extractVersionNotes(swallowing, "0.9.0", "CHANGELOG.md")).toThrowError(/0\.8\.0/);
  });

  it("does not mistake a paragraph quoting fence syntax for a fence", () => {
    // CommonMark: a backtick fence's info string may not contain a backtick, so
    // this line opens nothing and the document is valid.
    const quoted = ["## 0.8.0 — 2026-08-03", "", "```a`b", "", "Tail.", ""].join("\n");

    expect(extractVersionNotes(quoted, "0.8.0")).toContain("Tail.");
  });
});

describe("a `##` line inside an HTML comment", () => {
  it("neither truncates the body nor leaves the comment open", () => {
    const commented = [
      "## 0.8.0 — 2026-08-03",
      "",
      "Mine.",
      "",
      "<!--",
      "## a heading held back for later",
      "-->",
      "",
      "Tail.",
      "",
    ].join("\n");

    const notes = extractVersionNotes(commented, "0.8.0");
    expect(notes).toContain("Tail.");
    expect(notes).toContain("-->");
  });

  it("errors when the comment hides a real version heading", () => {
    const unclosed = [
      "## 0.8.0 — 2026-08-03",
      "",
      "<!-- someone forgot the close",
      "",
      "## 0.7.0 — 2026-07-27",
      "",
      "Oldest.",
      "",
    ].join("\n");

    expect(() => extractVersionNotes(unclosed, "0.8.0", "CHANGELOG.md")).toThrowError(/comment/i);
    expect(() => extractVersionNotes(unclosed, "0.8.0", "CHANGELOG.md")).toThrowError(/0\.7\.0/);
  });

  it("errors on an unclosed comment even when it hides no heading at all", () => {
    const unclosed = ["## 0.8.0 — 2026-08-03", "", "Mine. <!-- trailing thought", ""].join("\n");

    expect(() => extractVersionNotes(unclosed, "0.8.0", "CHANGELOG.md")).toThrowError(
      /never closed/i,
    );
  });

  it("leaves a comment that opens and closes on one line alone", () => {
    const inline = ["## 0.8.0 — 2026-08-03", "", "Mine. <!-- a note -->", "", "Tail.", ""].join(
      "\n",
    );

    expect(extractVersionNotes(inline, "0.8.0")).toContain("Tail.");
  });
});

describe("a heading indented the way CommonMark allows", () => {
  const INDENTED = [
    "## 0.8.0 — 2026-08-03",
    "",
    "Mine.",
    "",
    "  ## 0.7.0 — 2026-07-27",
    "",
    "NOT MINE.",
    "",
  ].join("\n");

  it("ends the section above it instead of merging the two", () => {
    expect(extractVersionNotes(INDENTED, "0.8.0")).toBe("Mine.");
  });

  it("is a section of its own, extractable and listed", () => {
    expect(listVersions(INDENTED)).toEqual(["0.8.0", "0.7.0"]);
    expect(extractVersionNotes(INDENTED, "0.7.0")).toBe("NOT MINE.");
  });

  it("stops being a heading at four spaces, where it is an indented code block", () => {
    const code = [
      "## 0.8.0 — 2026-08-03",
      "",
      "Mine.",
      "",
      "    ## 0.7.0 — 2026-07-27",
      "",
      "Tail.",
      "",
    ].join("\n");

    expect(extractVersionNotes(code, "0.8.0")).toContain("Tail.");
    expect(listVersions(code)).toEqual(["0.8.0"]);
  });
});

describe("a version declared twice", () => {
  it("throws rather than silently publishing the first of the two", () => {
    const twice = [
      "## 0.8.0 — 2026-08-03",
      "",
      "First.",
      "",
      "## 0.8.0 — 2026-08-04",
      "",
      "Second.",
      "",
    ].join("\n");

    expect(() => extractVersionNotes(twice, "0.8.0", "CHANGELOG.md")).toThrowError(/0\.8\.0/);
    expect(() => extractVersionNotes(twice, "0.8.0", "CHANGELOG.md")).toThrowError(/twice/i);
  });
});

describe("listVersions", () => {
  it("names the version headings in file order, and nothing else", () => {
    expect(listVersions(THREE_VERSIONS)).toEqual(["0.9.0", "0.8.0", "0.7.0"]);
  });

  it("ignores a heading that only appears as a fenced placeholder", () => {
    expect(listVersions("```\n## <version> — <YYYY-MM-DD>\n```\n")).toEqual([]);
  });

  it("is what tells a failed release which sections do exist", () => {
    expect(() => extractVersionNotes(THREE_VERSIONS, "1.0.0", "CHANGELOG.md")).toThrowError(
      /0\.9\.0, 0\.8\.0, 0\.7\.0/,
    );
  });
});

describe("the real CHANGELOG.md", () => {
  const changelog = readFileSync("CHANGELOG.md", "utf8");

  // Not a docs fixture (decision 0035 §2): this file is an input the release
  // workflow parses, so what is asserted is that it parses — never that it
  // says a particular thing. Whether the version *being released* has a section
  // is checkable only when a tag exists, and `release.yml` is where that is
  // checked; a version named here would outlive the release it guarded.
  it("parses, and every section it declares has a body", () => {
    const versions = listVersions(changelog);
    expect(versions.length).toBeGreaterThan(0);

    for (const version of versions) {
      expect(extractVersionNotes(changelog, version, "CHANGELOG.md")).not.toContain(
        `## ${version}`,
      );
    }
  });
});
