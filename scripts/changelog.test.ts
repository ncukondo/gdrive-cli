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
      "## 0.9.0 — 2026-09-01",
      "```",
      "",
      "## 0.9.0 — 2026-09-01",
      "",
      "The real 0.9.0 notes.",
      "",
    ].join("\n");

    expect(extractVersionNotes(fenced, "0.9.0")).toBe("The real 0.9.0 notes.");
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
});

describe("listVersions", () => {
  it("names the version headings in file order, and nothing else", () => {
    expect(listVersions(THREE_VERSIONS)).toEqual(["0.9.0", "0.8.0", "0.7.0"]);
  });

  it("ignores a heading that only appears as a fenced example", () => {
    expect(listVersions("```\n## 0.9.0 — 2026-09-01\n```\n")).toEqual([]);
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
  // says a particular thing.
  it("extracts every section it declares, heading stripped and body intact", () => {
    const versions = listVersions(changelog);
    expect(versions.length).toBeGreaterThan(0);

    for (const version of versions) {
      const notes = extractVersionNotes(changelog, version, "CHANGELOG.md");
      expect(notes).not.toContain(`## ${version}`);
      expect(notes.split("\n").filter((line) => line.startsWith("## "))).toEqual([]);
    }
  });

  it("still has the section 0.8.0 will be released from", () => {
    expect(listVersions(changelog)).toContain("0.8.0");
  });
});
