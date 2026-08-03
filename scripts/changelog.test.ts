import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HEADING_FORMAT, extractVersionNotes } from "./changelog.ts";

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
});

describe("the real CHANGELOG.md", () => {
  it("has a section for the version this branch is preparing", () => {
    const notes = extractVersionNotes(
      readFileSync("CHANGELOG.md", "utf8"),
      "0.8.0",
      "CHANGELOG.md",
    );

    expect(notes).toContain("### Breaking changes");
    expect(notes).not.toContain("## 0.8.0");
  });
});
