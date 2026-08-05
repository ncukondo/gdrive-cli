#!/usr/bin/env bun
/**
 * Decides whether a shell command an agent is about to run breaks a rule that
 * only matters *before* it runs (decision 0045 §1).
 *
 * Both rules here are ones a `pre-commit` hook cannot reach in time.
 * `git add -A` stages the file the agent did not mean to touch, and the commit
 * that follows is correct by every check a hook could apply — 0001 asks for
 * specific paths precisely because the mistake is invisible afterwards. And a
 * pull request opened before its branch is rebased hands the reviewer a diff
 * containing commits the branch never made (0044 §1); once the request exists,
 * the stale base is recorded and the round is already spent.
 *
 * There is no escape hatch, and that is deliberate: 0045 §2 gives the bypass to
 * a person, who has `git commit --no-verify` and a shell, and withholds it from
 * an agent, because a guard something can talk its way past is not a guard.
 *
 * The pure function is here; `.claude/hooks/guard-bash.ts` is the shim that
 * feeds it the hook payload and turns a block into exit code 2.
 */
import { execFileSync } from "node:child_process";

export interface RepoState {
  /** Whether `main` is an ancestor of `HEAD` — i.e. nothing to rebase onto. */
  rebased: boolean;
}

export interface Block {
  /** Short slug for the rule, so a caller can tell the two apart. */
  rule: "stage-specific-paths" | "rebase-before-review";
  message: string;
}

/** Splits a compound command into the segments a shell would run separately. */
function segments(command: string): string[][] {
  return command.split(/&&|\|\||[;|\n]/).map((segment) =>
    segment
      .trim()
      .split(/\s+/)
      .filter((token) => token !== ""),
  );
}

/** Whether `tokens` stages the whole tree rather than named paths. */
function stagesEverything(tokens: string[]): boolean {
  if (tokens[0] !== "git" || tokens[1] !== "add") return false;

  for (const token of tokens.slice(2)) {
    // Everything after `--` is a pathspec, so a file really named `-A` is fine.
    if (token === "--") return false;
    if (token === "." || token === "./" || token === "--all") return true;
    if (/^-[A-Za-z]*A[A-Za-z]*$/.test(token)) return true;
  }
  return false;
}

/** Whether `tokens` asks for a review rather than reading one. */
function requestsReview(tokens: string[]): boolean {
  return (
    tokens[0] === "gh" && tokens[1] === "pr" && (tokens[2] === "create" || tokens[2] === "ready")
  );
}

/** The rule `command` would break, or null when it breaks neither. */
export function checkBashCommand(command: string, state: RepoState): Block | null {
  for (const tokens of segments(command)) {
    if (stagesEverything(tokens)) {
      return {
        rule: "stage-specific-paths",
        message:
          "Stage the paths you mean, not the whole tree (decision 0001).\n" +
          "A commit built from `git add -A` is indistinguishable from a correct one\n" +
          "afterwards, which is why this is refused before it runs rather than checked\n" +
          "after. Name each file: `git add src/index.ts tests/index.test.ts`.\n" +
          "`git status --short` lists what is there to choose from.",
      };
    }

    if (requestsReview(tokens) && !state.rebased) {
      return {
        rule: "rebase-before-review",
        message:
          "Rebase before requesting review (decision 0044 §1).\n" +
          "main has moved since this branch was cut. GitHub records a pull request's\n" +
          "base when it is opened, so the reviewer would be handed the main-only\n" +
          "commits — including this task's own plan — replayed as if the branch had\n" +
          "made them. That is what cost #16 a full round.\n\n" +
          "  git rebase main && git push --force-with-lease\n\n" +
          "Then open the request; the diff will be the branch's own work.",
      };
    }
  }

  return null;
}

/** Whether `main` is already an ancestor of `HEAD`; true when git cannot say. */
export function isRebased(): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", "main", "HEAD"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
