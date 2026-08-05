#!/usr/bin/env bun
/**
 * Fails a commit that puts work on the wrong side of the review boundary
 * (decisions 0033 §1, 0044 §1, 0047 §5).
 *
 * The two directions fail differently, and neither is obvious while it is
 * happening. Implementation committed to `main` skips the fresh reader 0033 §2
 * exists to provide, and by the time anyone notices, the reason to review it has
 * expired. A record committed to a `task/*` branch is worse than untidy: GitHub
 * stores a pull request's base when it is opened, so `tasks/` commits that
 * belong on main get replayed into the branch's diff as if the branch had made
 * them. Pull request #16 handed its reviewer a three-file plan against a
 * five-file branch that way, and the round was spent on the discrepancy.
 *
 * Usage: `bun scripts/lint-landing.ts` — reads the current branch and the staged
 * diff, exits 1 with the branch each staged file belongs on.
 */
import { execFileSync } from "node:child_process";

/** Everything 0033 §1 and 0047 §5 send through a pull request. */
const REVIEWED_PREFIXES = [
  "src/",
  "tests/",
  "docs/",
  "scripts/",
  ".github/",
  ".husky/",
  ".claude/",
];
const REVIEWED_FILES = ["package.json", "bun.lock", "install.sh", "install.ps1"];

/** The record directories, which 0033 §1 keeps off every branch. */
const RECORD_PREFIXES = ["decisions/", "tasks/"];

export interface LandingFinding {
  path: string;
  message: string;
}

/**
 * A directory's `CLAUDE.md` sits inside a record directory without being a
 * record: 0032 §6 classes it as description rather than a dated file, and
 * 0047 §5 lands it through review with the code it describes. Read without this
 * exception the two rules deadlock, because `decisions/CLAUDE.md` would be
 * refused on main as a reviewed file and refused on a branch as a record.
 *
 * The root `CLAUDE.md` has no slash and so is not one of these. Nothing here has
 * an opinion about it, because 0047 §5 does not name it.
 */
function isDirectoryGuide(path: string): boolean {
  return path.endsWith("/CLAUDE.md");
}

function isReviewed(path: string): boolean {
  if (isDirectoryGuide(path)) return true;
  return REVIEWED_PREFIXES.some((p) => path.startsWith(p)) || REVIEWED_FILES.includes(path);
}

function isRecord(path: string): boolean {
  if (isDirectoryGuide(path)) return false;
  return RECORD_PREFIXES.some((p) => path.startsWith(p));
}

/** Where each staged path does not belong, given the branch it is being committed on. */
export function checkLanding(branch: string, paths: string[]): LandingFinding[] {
  if (branch === "main") {
    return paths.filter(isReviewed).map((path) => ({
      path,
      message:
        `${path} lands through a pull request, not on main.\n` +
        `    Cut a task/00NN-slug branch matching the task file, commit there, and\n` +
        `    let an agent holding none of the implementation context read the diff\n` +
        `    against the task's acceptance criteria (decision 0033 §1–§2).`,
    }));
  }

  if (branch.startsWith("task/")) {
    return paths.filter(isRecord).map((path) => ({
      path,
      message:
        `${path} is a record and commits straight to main, not onto this branch.\n` +
        `    GitHub stores a pull request's base when it is opened, so a record\n` +
        `    committed here is replayed into the diff as if the branch had made it —\n` +
        `    which is how #16's reviewer measured a five-file branch against a\n` +
        `    three-file plan (decisions 0033 §1, 0044 §1). Commit it on main, then\n` +
        `    "git rebase main" so the branch's diff is its own work.`,
    }));
  }

  // 0033 §1 legislates for main and for task branches. A branch that is neither
  // is outside what any decision has settled, and inventing a third policy here
  // would be this file making a rule rather than executing one.
  return [];
}

function currentBranch(): string {
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
}

function stagedPaths(): string[] {
  const out = execFileSync("git", ["diff", "--cached", "--name-only", "-z"], { encoding: "utf8" });
  return out.split("\0").filter((path) => path !== "");
}

if (import.meta.main) {
  const branch = currentBranch();
  const findings = checkLanding(branch, stagedPaths());

  if (findings.length > 0) {
    process.stderr.write(
      `${findings.length} staged file(s) do not belong on "${branch}" — see\n` +
        `decisions/0033-implementation-lands-through-review.md §1.\n\n`,
    );
    for (const finding of findings) process.stderr.write(`  ${finding.message}\n\n`);
    process.exit(1);
  }
}
