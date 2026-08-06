/**
 * The record checks, run against this repository's own records.
 *
 * Every other test in this directory builds its input from the same assumptions
 * as the code beside it, so all of them can be green while a check is wrong
 * about the corpus it exists to police. That is not hypothetical: review of
 * pull request #23 found `checkStatusLine` refusing `decisions/0046`, the newest
 * record on main at the time, because the plan had named the two verbs 0032 §3
 * glosses rather than the ones the records use.
 *
 * This is hermetic in the sense that matters — `readFileSync`, no git, no
 * network — and it is the only thing here that can contradict the author.
 *
 * When it fails, the question is which is wrong: usually the check, sometimes
 * the record. Do not narrow the corpus to make it pass.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkArchivedTasks, checkStatusLine } from "./lint-records.js";

const DECISIONS = "decisions";

/**
 * 0032's `Out of scope` grandfathers the files edited in place before it was
 * written — "0011, 0016 and 0021 stay as they are" — and 0011 and 0016 are the
 * two whose `Status` lines carry that history. They are excluded by name and by
 * that reason, not because the check is inconvenient.
 */
const GRANDFATHERED = new Set(["0011-sharing-commands.md", "0016-shared-drive-scope.md"]);

const decisionFiles = readdirSync(DECISIONS)
  .filter((name) => /^\d{4}-.+\.md$/.test(name))
  .sort();

describe("the records this repository actually has", () => {
  it("has decisions to check, so a passing suite means something", () => {
    expect(decisionFiles.length).toBeGreaterThan(40);
  });

  describe("checkStatusLine", () => {
    for (const name of decisionFiles.filter((n) => !GRANDFATHERED.has(n))) {
      it(`accepts ${name}`, () => {
        const source = readFileSync(join(DECISIONS, name), "utf8");
        expect(checkStatusLine(`${DECISIONS}/${name}`, source)).toEqual([]);
      });
    }

    it("still refuses the two 0032 grandfathered, so the exclusion is doing work", () => {
      for (const name of GRANDFATHERED) {
        const source = readFileSync(join(DECISIONS, name), "utf8");
        expect(checkStatusLine(`${DECISIONS}/${name}`, source), name).not.toEqual([]);
      }
    });
  });

  it("checkArchivedTasks passes the live plan table", () => {
    expect(checkArchivedTasks(readFileSync("tasks/README.md", "utf8"))).toEqual([]);
  });
});
