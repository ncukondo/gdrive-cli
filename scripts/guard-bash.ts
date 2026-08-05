/**
 * Decides whether a shell command an agent is about to run breaks a rule that
 * only matters *before* it runs (decision 0047 §1).
 *
 * This is a library, not a command: there is no `import.meta.main` and no
 * `package.json` entry, because the only caller is
 * `.claude/hooks/guard-bash.ts`, which feeds it the hook payload and turns a
 * block into exit code 2.
 *
 * Both rules here are ones a `pre-commit` hook cannot reach in time. Staging
 * that nobody named catches the file the agent did not mean to touch, and the
 * commit that follows is correct by every check a hook could apply — 0001 asks
 * for specific paths precisely because the mistake is invisible afterwards. And
 * a pull request opened before its branch is rebased hands the reviewer a diff
 * containing commits the branch never made (0044 §1); once the request exists,
 * the stale base is recorded and the round is already spent.
 *
 * There is no escape hatch, and that is deliberate: 0047 §2 gives the bypass to
 * a person, who has `git commit --no-verify` and a shell, and withholds it from
 * an agent, because a guard something can talk its way past is not a guard.
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

/**
 * Splits a command into whitespace-separated tokens, keeping a quoted run
 * together as one.
 *
 * Quote awareness is not decoration here. `git commit -m "fix the -a flag"`
 * splits naively into a token that is exactly `-a`, and the staging rule below
 * would refuse a commit whose message merely mentions one.
 */
function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | undefined;
  let started = false;

  for (let i = 0; i < segment.length; i++) {
    const char = segment[i] ?? "";
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (current !== "" || started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += char;
  }
  if (current !== "" || started) tokens.push(current);
  return tokens;
}

/** Splits a compound command into the segments a shell would run separately. */
function segments(command: string): string[][] {
  return command.split(/&&|\|\||[;|\n]/).map((segment) => tokenize(segment.trim()));
}

/** Global options that swallow the next token, so the subcommand is not there. */
const GIT_GLOBAL_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

/**
 * The git subcommand and its arguments, looking past global options.
 *
 * `git -C . add -A` is `git add -A` with a word in front, and a guard that reads
 * `tokens[1]` misses it — one of the seven spellings the #23 review got through
 * ([0048](../decisions/0048-staging-refuses-a-class.md) §2).
 */
function gitCommand(tokens: string[]): { name: string; args: string[] } | null {
  if (tokens[0] !== "git") return null;

  let i = 1;
  while (i < tokens.length) {
    const token = tokens[i] ?? "";
    if (!token.startsWith("-")) break;
    i += GIT_GLOBAL_WITH_VALUE.has(token) ? 2 : 1;
  }

  const name = tokens[i];
  return name === undefined ? null : { name, args: tokens.slice(i + 1) };
}

/** A short-flag cluster carrying `letter`, e.g. `a` in `-am`. */
const cluster = (letter: string) => new RegExp(String.raw`^-[A-Za-z]*${letter}[A-Za-z]*$`);

/**
 * Whether `tokens` adds to the index something the caller did not name as a
 * path ([0048](../decisions/0048-staging-refuses-a-class.md) §1).
 *
 * The list below is this rule's current approximation and is expected to be
 * incomplete — 0048 §2 is explicit that a spelling which gets through is a
 * defect here rather than a permission, so do not read the allowed set as the
 * permitted set.
 */
function stagesUnnamed(tokens: string[]): boolean {
  const git = gitCommand(tokens);
  if (git === null) return false;

  if (git.name === "add" || git.name === "stage") {
    for (const token of git.args) {
      // Everything after `--` is a pathspec, so a file really named `-A` commits.
      if (token === "--") return false;
      if (token === "." || token === "./" || token === "*") return true;
      if (token === "--all" || token === "--update" || token === "--no-ignore-removal") return true;
      if (cluster("A").test(token) || cluster("u").test(token)) return true;
    }
    return false;
  }

  if (git.name === "commit") {
    for (const token of git.args) {
      if (token === "--") return false;
      if (token === "--all") return true;
      // `--amend` and `--allow-empty` start with `--` and are matched exactly
      // above, so only a short cluster reaches this.
      if (!token.startsWith("--") && cluster("a").test(token)) return true;
    }
    return false;
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
    if (stagesUnnamed(tokens)) {
      return {
        rule: "stage-specific-paths",
        message:
          "Stage the paths you mean (decisions 0001, 0048 §1).\n" +
          "This command adds to the index something you did not name. A commit built\n" +
          "that way is indistinguishable from a correct one afterwards, which is why\n" +
          "it is refused before it runs rather than checked after.\n\n" +
          "  git status --short              # what there is to choose from\n" +
          "  git add src/index.ts tests/index.test.ts\n\n" +
          "`git commit -a` and `-am` are the same rule: they stage every tracked\n" +
          "change without naming one. Stage, then commit.",
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

/**
 * Whether `main` is already an ancestor of `HEAD`.
 *
 * Two failures look identical to `merge-base` and must not be treated alike. If
 * `main` resolves and is not an ancestor, the branch is behind and the answer is
 * `false`. If `main` does not resolve at all — a clone with a different default
 * branch, a worktree that never fetched it — then there is nothing to rebase
 * onto, and answering `false` would tell an agent to run `git rebase main` in a
 * repository that has no `main`, with no bypass (0047 §2) and no way out.
 *
 * So the missing-ref case fails open. That is the narrow exception: a guard that
 * cannot be satisfied is worse than one that does not fire.
 */
export function isRebased(): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", "main"], { stdio: "ignore" });
  } catch {
    return true;
  }

  try {
    execFileSync("git", ["merge-base", "--is-ancestor", "main", "HEAD"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
