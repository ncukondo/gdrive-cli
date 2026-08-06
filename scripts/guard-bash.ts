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
import { existsSync } from "node:fs";

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
 * One token of a command line: a word, or a shell operator that separates two
 * commands.
 *
 * Tokenizing *before* splitting is what makes the split correct. Splitting the
 * raw string on `;` or `|` first refuses
 * `git commit -m "refuse git add -A; git add . too"` — a message this
 * repository's own commits are full of — because the separator inside the quotes
 * is not a separator at all.
 */
interface Token {
  kind: "word" | "operator";
  value: string;
  /** True when the word arrived inside quotes, so it is one argument. */
  quoted: boolean;
}

const OPERATORS = ["&&", "||", ";;", ";", "|", "&", "\n"];

function tokenize(command: string): Token[] {
  const tokens: Token[] = [];
  let current = "";
  let quoted = false;
  let started = false;
  let quote: string | undefined;

  const flush = () => {
    if (current !== "" || started) tokens.push({ kind: "word", value: current, quoted });
    current = "";
    started = false;
    quoted = false;
  };

  for (let i = 0; i < command.length; i++) {
    const char = command[i] ?? "";

    if (quote !== undefined) {
      if (char === "\\" && quote === '"') {
        current += command[++i] ?? "";
      } else if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\\") {
      current += command[++i] ?? "";
      started = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      quoted = true;
      started = true;
      continue;
    }

    const operator = OPERATORS.find((op) => command.startsWith(op, i));
    if (operator !== undefined) {
      flush();
      tokens.push({ kind: "operator", value: operator, quoted: false });
      i += operator.length - 1;
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    current += char;
  }
  flush();
  return tokens;
}

/** The words of each command the shell would run separately. */
function segments(command: string): Token[][] {
  const out: Token[][] = [[]];
  for (const token of tokenize(command)) {
    if (token.kind === "operator") out.push([]);
    else (out[out.length - 1] ?? []).push(token);
  }
  return out.filter((segment) => segment.length > 0);
}

/** Leading noise a shell leaves in a segment: punctuation and block keywords. */
const SHELL_LEAD = new Set([
  "(",
  ")",
  "{",
  "}",
  "!",
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "do",
  "done",
  "while",
  "until",
]);

/**
 * Words that run the command after them. Unlisted ones are the reason this is
 * not a complete rule ([0048](../decisions/0048-staging-refuses-a-class.md) §2);
 * the interpreters below are handled separately, because their command arrives
 * as a single quoted argument rather than as the rest of the line.
 */
const WRAPPERS = new Set([
  "sudo",
  "doas",
  "env",
  "command",
  "exec",
  "nohup",
  "time",
  "builtin",
  "nice",
  "ionice",
  "timeout",
  "stdbuf",
  "setsid",
  "xargs",
  "unbuffer",
  "script",
]);

/** Interpreters whose *argument* is another command to check. */
const INTERPRETERS = new Set(["bash", "sh", "zsh", "dash", "ksh", "eval"]);

/** Global git options that swallow the next token. */
const GIT_GLOBAL_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

/** Long options that stage without naming anything; matched by unambiguous prefix. */
const IMPLICIT_LONG = ["--all", "--update", "--no-ignore-removal"];
const IMPLICIT_SHORT_ADD = new Set(["-A", "-u"]);
const IMPLICIT_SHORT_COMMIT = new Set(["-a"]);

/** Flags that make an empty pathspec list legitimate, because a person picks. */
const INTERACTIVE = new Set(["-p", "-i", "--patch", "--interactive"]);

export interface Invocation {
  binary: string;
  sub: string;
  /** Flags before `--`, short clusters expanded so `-am` yields `-a` and `-m`. */
  flags: string[];
  /** Path arguments, from before and after `--`. */
  pathspecs: string[];
  /** A command carried as an argument, for `bash -c '…'` and `eval '…'`. */
  nested: string[];
}

/**
 * Normalises one segment into the question the rules below ask.
 *
 * Both rules go through this. An earlier version normalised only the git side,
 * so `sudo gh pr create` walked past a guard that caught `sudo git add -A` —
 * two places to stop looking, which is the shape 0048 §2 warns about rather than
 * any particular spelling.
 */
export function parseInvocation(words: Token[]): Invocation | null {
  let i = 0;
  const nested: string[] = [];

  for (;;) {
    while (i < words.length) {
      const word = words[i];
      if (word === undefined) break;
      const value = word.value;
      if (SHELL_LEAD.has(value) || /^[A-Za-z_]\w*=/.test(value)) i++;
      else break;
    }
    const head = (words[i]?.value ?? "").split("/").pop() ?? "";
    if (WRAPPERS.has(head)) {
      i++;
      // Skip the wrapper's own arguments to reach the command it runs: its
      // options, and a bare duration or count, because `timeout 5 git add -A`
      // and `xargs -n 1 git add` both put a non-option between the two.
      while (i < words.length) {
        const value = words[i]?.value ?? "";
        if (value.startsWith("-") || /^\d+[smhd]?$/.test(value)) i++;
        else break;
      }
      continue;
    }
    if (INTERPRETERS.has(head)) {
      // `bash -c '<command>'` and `eval '<command>'`: the argument is a command.
      for (const word of words.slice(i + 1)) {
        if (word.quoted || !word.value.startsWith("-")) nested.push(word.value);
      }
      return { binary: head, sub: "", flags: [], pathspecs: [], nested };
    }
    break;
  }

  const binary = (words[i]?.value ?? "").split("/").pop() ?? "";
  if (binary === "") return null;
  i++;

  if (binary === "git") {
    while (i < words.length) {
      const value = words[i]?.value ?? "";
      if (!value.startsWith("-")) break;
      i += GIT_GLOBAL_WITH_VALUE.has(value) ? 2 : 1;
    }
  }

  const sub = words[i]?.value ?? "";
  const flags: string[] = [];
  const pathspecs: string[] = [];
  let separated = false;

  for (const word of words.slice(i + 1)) {
    if (!separated && !word.quoted && word.value === "--") {
      separated = true;
      continue;
    }
    if (separated || !word.value.startsWith("-")) {
      pathspecs.push(word.value);
      continue;
    }
    if (/^-[A-Za-z]+$/.test(word.value)) {
      for (const letter of word.value.slice(1)) flags.push(`-${letter}`);
    } else {
      flags.push(word.value);
    }
  }

  return { binary, sub, flags, pathspecs, nested };
}

/** Whether a long flag is one git would resolve to an implicit-staging option. */
function stagesByLongFlag(flag: string): boolean {
  if (!flag.startsWith("--") || flag.length < 3) return false;
  // git's parse-options accepts any unambiguous prefix, so `--al` is `--all`.
  // `--no-all` and `--ignore-removal` are prefixes of nothing here, which is
  // what keeps the negations out.
  return IMPLICIT_LONG.some((full) => full.startsWith(flag));
}

/**
 * Whether a pathspec names something, as opposed to sweeping whatever is there.
 *
 * `./src` names a directory. `.`, `..` and anything beginning `:` do not — the
 * colon opens git's pathspec magic, where `:`, `:/`, `:(top)` and `:!sub` all
 * reach outside what was typed. A glob names whatever matches, unless a file of
 * that exact name exists, which is the same reasoning 0048 §1 applies to a file
 * named `-A`.
 */
export function isNamedPath(spec: string, exists: (path: string) => boolean): boolean {
  if (["", ".", "./", "..", "../"].includes(spec)) return false;
  if (spec.startsWith(":")) return false;
  if (/[*?]|\[[^\]]*\]/.test(spec)) return exists(spec);
  return true;
}

/**
 * Whether an invocation adds to the index something the caller did not name
 * ([0048](../decisions/0048-staging-refuses-a-class.md) §1).
 */
function stagesUnnamed(git: Invocation, exists: (path: string) => boolean): boolean {
  if (git.binary !== "git") return false;

  if (git.sub === "add" || git.sub === "stage") {
    if (git.flags.some((f) => IMPLICIT_SHORT_ADD.has(f) || stagesByLongFlag(f))) return true;
    if (git.pathspecs.some((spec) => !isNamedPath(spec, exists))) return true;
    // No path and no interactive flag: the set comes from somewhere this cannot
    // see, such as `xargs`, or the command is an error either way.
    return git.pathspecs.length === 0 && !git.flags.some((f) => INTERACTIVE.has(f));
  }

  if (git.sub === "commit") {
    return git.flags.some((f) => IMPLICIT_SHORT_COMMIT.has(f) || stagesByLongFlag(f));
  }

  return false;
}

/** Whether an invocation asks for a review rather than reading one. */
function requestsReview(inv: Invocation): boolean {
  return (
    inv.binary === "gh" && inv.sub === "pr" && ["create", "ready"].includes(inv.pathspecs[0] ?? "")
  );
}

const STAGE_MESSAGE =
  "Stage the paths you mean (decisions 0001, 0048 §1).\n" +
  "This command adds to the index something you did not name. A commit built\n" +
  "that way is indistinguishable from a correct one afterwards, which is why\n" +
  "it is refused before it runs rather than checked after.\n\n" +
  "  git status --short              # what there is to choose from\n" +
  "  git add src/index.ts tests/index.test.ts\n\n" +
  "`git commit -a` and `-am` are the same rule: they stage every tracked change\n" +
  "without naming one. Stage, then commit. A flag like `-A` is refused even\n" +
  "beside a path — drop the flag, the path is enough.";

const REBASE_MESSAGE =
  "Rebase before requesting review (decision 0044 §1).\n" +
  "main has moved since this branch was cut. GitHub records a pull request's\n" +
  "base when it is opened, so the reviewer would be handed the main-only\n" +
  "commits — including this task's own plan — replayed as if the branch had\n" +
  "made them. That is what cost #16 a full round.\n\n" +
  "  git rebase main && git push --force-with-lease\n\n" +
  "Then open the request; the diff will be the branch's own work.";

/**
 * The rule `command` would break, or null when it breaks neither.
 *
 * `exists` is injected so the glob test can ask the filesystem without the tests
 * needing one (0012).
 */
export function checkBashCommand(
  command: string,
  state: RepoState,
  exists: (path: string) => boolean = existsSync,
  depth = 0,
): Block | null {
  for (const words of segments(command)) {
    const inv = parseInvocation(words);
    if (inv === null) continue;

    // `bash -c '…'` and `eval '…'` carry a command as an argument. Recursing is
    // bounded: a command that nests this deep is not something to reason about.
    if (inv.nested.length > 0) {
      if (depth >= 3) return { rule: "stage-specific-paths", message: STAGE_MESSAGE };
      for (const inner of inv.nested) {
        const block = checkBashCommand(inner, state, exists, depth + 1);
        if (block !== null) return block;
      }
      continue;
    }

    if (stagesUnnamed(inv, exists)) return { rule: "stage-specific-paths", message: STAGE_MESSAGE };
    if (requestsReview(inv) && !state.rebased) {
      return { rule: "rebase-before-review", message: REBASE_MESSAGE };
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
