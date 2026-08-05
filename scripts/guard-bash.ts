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

/** Leading noise a shell leaves in a segment: punctuation and block keywords. */
const SHELL_LEAD = new Set(["(", ")", "{", "}", "!", "if", "then", "else", "elif", "do", "while"]);

/** Words that run the command that follows them, so the real binary is later. */
const WRAPPERS = new Set(["sudo", "env", "command", "exec", "nohup", "time", "builtin"]);

/** Global git options that swallow the next token, so the subcommand is not there. */
const GIT_GLOBAL_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

/** Flags that stage without naming anything, once a cluster is expanded. */
const IMPLICIT_ADD_FLAGS = new Set(["-A", "-u", "--all", "--update", "--no-ignore-removal"]);
const IMPLICIT_COMMIT_FLAGS = new Set(["-a", "--all"]);

/**
 * A parsed git invocation: what it is, which flags it carries before `--`, and
 * every pathspec on either side of it.
 *
 * Normalising here is what lets the rule below be one question. Two review
 * rounds found sixteen spellings, and every one of them was a way of moving the
 * interesting token somewhere the previous scan had stopped looking — behind a
 * wrapper word, behind an environment assignment, behind shell punctuation,
 * behind an absolute path, behind a global option, or behind `--`. None of them
 * changed what the command does to the index.
 */
interface GitInvocation {
  name: string;
  /** Flags before `--`, with short clusters expanded so `-am` yields `-a`. */
  flags: string[];
  /** Everything that is a path argument, from before and after `--`. */
  pathspecs: string[];
}

function parseGit(tokens: string[]): GitInvocation | null {
  let i = 0;
  // Shell punctuation, block keywords, environment assignments and wrapper
  // words all sit in front of the binary without changing it.
  while (i < tokens.length) {
    const token = tokens[i] ?? "";
    if (SHELL_LEAD.has(token) || WRAPPERS.has(token) || /^[A-Za-z_][\w]*=/.test(token)) i++;
    else break;
  }

  // `/usr/bin/git` is git. Match the basename, not the string.
  const binary = (tokens[i] ?? "").split("/").pop();
  if (binary !== "git") return null;
  i++;

  while (i < tokens.length) {
    const token = tokens[i] ?? "";
    if (!token.startsWith("-")) break;
    i += GIT_GLOBAL_WITH_VALUE.has(token) ? 2 : 1;
  }

  const name = tokens[i];
  if (name === undefined) return null;

  const flags: string[] = [];
  const pathspecs: string[] = [];
  let separated = false;

  for (const token of tokens.slice(i + 1)) {
    if (!separated && token === "--") {
      separated = true;
      continue;
    }
    // After `--` every token is a path, which is 0048 §1's carve-out: a file
    // genuinely named `-A` still commits. That is about the *name*, not about
    // switching the rule off — a `.` after `--` is as unnamed as one before it.
    if (separated || !token.startsWith("-")) {
      pathspecs.push(token);
      continue;
    }
    // Expand a short cluster: `-am` is `-a` and `-m`.
    if (/^-[A-Za-z]+$/.test(token) && !token.startsWith("--")) {
      for (const letter of token.slice(1)) flags.push(`-${letter}`);
    } else {
      flags.push(token);
    }
  }

  return { name, flags, pathspecs };
}

/**
 * Whether a pathspec names something, as opposed to sweeping whatever is there.
 *
 * `./src` names a directory and is allowed. `.`, `..` and `:/` name the tree,
 * and a glob names whatever happens to match — in both cases the caller has not
 * said which files they mean, which is the whole of 0001's rule.
 */
function isNamedPath(spec: string): boolean {
  if (["", ".", "./", "..", "../", ":/", ":/."].includes(spec)) return false;
  if (/[*?]|\[.*\]/.test(spec)) return false;
  return true;
}

/**
 * Whether `tokens` adds to the index something the caller did not name as a
 * path ([0048](../decisions/0048-staging-refuses-a-class.md) §1).
 *
 * One question over a normalised invocation: does a flag stage implicitly, or is
 * a pathspec not a named path? Every spelling either review found collapses into
 * it, and `--` stops being a special case.
 *
 * 0048 §2 is explicit that this remains an approximation and that a spelling
 * which gets through is a defect here rather than a permission. Do not read the
 * allowed set as the permitted set — two rounds of doing exactly that are why
 * this function has the shape it has.
 */
function stagesUnnamed(tokens: string[]): boolean {
  const git = parseGit(tokens);
  if (git === null) return false;

  if (git.name === "add" || git.name === "stage") {
    return (
      git.flags.some((flag) => IMPLICIT_ADD_FLAGS.has(flag)) ||
      git.pathspecs.some((spec) => !isNamedPath(spec))
    );
  }

  if (git.name === "commit") {
    return git.flags.some((flag) => IMPLICIT_COMMIT_FLAGS.has(flag));
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
