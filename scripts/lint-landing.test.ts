import { describe, expect, it } from "vitest";
import { checkLanding } from "./lint-landing.js";

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
    expect(onMain("decisions/0045-rules-are-executed.md", "decisions/README.md")).toEqual([]);
    expect(onMain("tasks/0040-x.md", "tasks/README.md", "tasks/archive/0039-y.md")).toEqual([]);
  });

  it("names the branch to use", () => {
    expect(onMain("src/index.ts")[0]?.message).toContain("task/00NN-slug");
  });

  it("says nothing about the root CLAUDE.md, which 0045 §5 does not name", () => {
    expect(onMain("CLAUDE.md")).toEqual([]);
    expect(onMain("README.md")).toEqual([]);
  });
});

describe("checkLanding on a task branch", () => {
  it("refuses a record, which is the phantom that cost #16 a review round", () => {
    expect(onTask("decisions/0045-x.md")).toHaveLength(1);
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
    expect(onMain("decisions/0045-x.md")).toEqual([]);
  });
});

describe("any other branch", () => {
  it("has no policy, because 0033 §1 states none", () => {
    expect(checkLanding("fix/typo", ["src/index.ts", "decisions/0045-x.md"])).toEqual([]);
    expect(checkLanding("HEAD", ["src/index.ts"])).toEqual([]);
  });
});
