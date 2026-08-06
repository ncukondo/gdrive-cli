import { describe, expect, it } from "vitest";
import { checkBashCommand } from "./guard-bash.js";

const rebased = { rebased: true };
const behind = { rebased: false };

/** No file exists unless a test says so, so a glob stays a glob. */
const noFiles = (_path: string) => false;

describe("staging the caller did not name (decisions 0001, 0050 §1)", () => {
  const blocked = (command: string, exists: (path: string) => boolean = noFiles) =>
    checkBashCommand(command, rebased, exists);

  it("blocks the spellings the first two review rounds got through", () => {
    for (const command of [
      "git add -A",
      "git add .",
      "git add --all",
      "git add -u",
      "git add --update",
      "git commit -a -m x",
      "git commit -am x",
      "git stage -A",
      "git -C . add -A",
      "git add *",
      "git add -- .",
      "git add :/",
      "git add *.ts",
      "git add src/*",
      "sudo git add -A",
      "env git add -A",
      "/usr/bin/git add -A",
      "( git add -A )",
      "GIT_DIR=.git git add -A",
      "git add ..",
      "sudo /usr/bin/git -C . stage -u",
    ]) {
      expect(blocked(command), command).not.toBeNull();
    }
  });

  it("blocks a long flag by unambiguous prefix, the way git resolves one", () => {
    // git's parse-options accepts any prefix that names one option, so these
    // stage everything even though the string is not `--all`.
    for (const command of ["git add --al", "git add --upd", "git add --no-ignore-remov"]) {
      expect(blocked(command), command).not.toBeNull();
    }
  });

  it("blocks every pathspec that opens git's magic syntax", () => {
    for (const command of [
      "git add :",
      "git add :(top)",
      "git add ':!sub'",
      "git add ':(glob,top)'",
    ]) {
      expect(blocked(command), command).not.toBeNull();
    }
  });

  it("blocks a wrapper word whether or not it takes an argument of its own", () => {
    for (const command of [
      "nice git add -A",
      "timeout 5 git add -A",
      "timeout 30s git add -A",
      "doas git add -A",
      "stdbuf -o0 git add -A",
      "setsid git add -A",
      "echo . | xargs git add",
      "xargs -n 1 git add",
    ]) {
      expect(blocked(command), command).not.toBeNull();
    }
  });

  it("blocks a command carried as an interpreter's argument", () => {
    for (const command of [
      "bash -c 'git add -A'",
      "sh -c 'git add .'",
      "bash -lc 'git add -A'",
      "eval 'git add -A'",
    ]) {
      expect(blocked(command), command).not.toBeNull();
    }
  });

  it("blocks past a bare `&`, which is a separator like `&&`", () => {
    expect(blocked("echo hi & git add -A")).not.toBeNull();
  });

  it("allows a named path, including one that only looks like a glob", () => {
    for (const command of [
      "git add ./src",
      "git add -- -A",
      "git add -- -A src/index.ts",
      "git add -N src/new.ts",
      "git add -p src/index.ts",
      "git add src/a.ts tests/b.ts",
      "git add --no-all src/x.ts",
    ]) {
      expect(blocked(command), command).toBeNull();
    }
    const onDisk = (path: string) => path === "docs/report [2026].md";
    expect(blocked("git add 'docs/report [2026].md'", onDisk)).toBeNull();
    expect(blocked("git add 'docs/report [2026].md'")).not.toBeNull();
  });

  it("allows the interactive forms, which name nothing because a person picks", () => {
    expect(blocked("git add -p")).toBeNull();
    expect(blocked("git add -i")).toBeNull();
  });

  it("allows the commit flags that stage nothing", () => {
    for (const command of [
      "git commit --amend --no-edit",
      "git commit --allow-empty -m x",
      "git commit --no-all -m x",
    ]) {
      expect(blocked(command), command).toBeNull();
    }
  });

  it("does not fire on a separator inside a quoted message", () => {
    // Splitting the raw string before tokenizing refused these, and this
    // repository's own commit messages are full of them.
    expect(blocked('git commit -m "refuse git add -A; git add . too"')).toBeNull();
    expect(blocked('git commit -m "guard: refuse git add -A | ..."')).toBeNull();
    expect(blocked("git commit -m 'stop using git add -A'")).toBeNull();
  });

  it("says nothing about other commands", () => {
    for (const command of [
      "git status",
      "git diff .",
      "git log -A",
      "bun run test",
      "echo 'git add -A'",
    ]) {
      expect(blocked(command), command).toBeNull();
    }
  });

  it("names the record that states the rule, which is the newest one", () => {
    expect(blocked("git add -A")?.message).toContain("0050");
  });

  it("treats a heredoc body as data, not as a list of commands", () => {
    // Every line of a `<<EOF … EOF` body used to be normalised as its own
    // invocation, so writing prose *about* staging — a commit message, a
    // pull-request body, a record in this repository — was refused.
    const body = (text: string) => `cat > /tmp/notes.md <<'EOF'\n${text}\nEOF`;
    expect(blocked(body("The guard refuses git add -A before it runs."))).toBeNull();
    expect(blocked(body("git add . is the same rule.\ngit rm -r . too."))).toBeNull();
    expect(
      blocked(
        `gh pr create --body-file - <<'EOF'\ngit add -A is never how a commit is staged.\nEOF`,
      ),
    ).toBeNull();
  });

  it("still sees a real command after the heredoc closes", () => {
    expect(blocked(`cat <<'EOF'\nhi\nEOF\ngit add -A`)).not.toBeNull();
  });

  it("blocks an interpreter's command whether or not it is quoted", () => {
    for (const command of ["eval git add -A", "eval git add .", "bash -c git add -A"]) {
      expect(blocked(command), command).not.toBeNull();
    }
  });
});

describe("requesting review before a rebase (decision 0044 §1)", () => {
  it("blocks gh pr create when main has moved past the branch", () => {
    expect(checkBashCommand("gh pr create --fill", behind)).not.toBeNull();
    expect(checkBashCommand("gh pr ready", behind)).not.toBeNull();
  });

  it("sees past the same wrappers the staging rule does", () => {
    // Both rules go through one normaliser now. They did not, and every shape
    // the staging tests celebrate catching was open on this side.
    for (const command of [
      "sudo gh pr create",
      "GH_TOKEN=x gh pr create",
      "/usr/bin/gh pr create",
      "( gh pr create )",
    ]) {
      expect(checkBashCommand(command, behind), command).not.toBeNull();
    }
  });

  it("allows it once the branch is rebased", () => {
    expect(checkBashCommand("gh pr create --fill", rebased)).toBeNull();
    expect(checkBashCommand("gh pr ready", rebased)).toBeNull();
  });

  it("prints the command that fixes it", () => {
    const block = checkBashCommand("gh pr create", behind);
    expect(block?.message).toContain("git rebase main");
    expect(block?.message).toContain("--force-with-lease");
  });

  it("says nothing about reading a pull request", () => {
    expect(checkBashCommand("gh pr view 16", behind)).toBeNull();
    expect(checkBashCommand("gh pr diff 16", behind)).toBeNull();
    expect(checkBashCommand("gh pr list", behind)).toBeNull();
  });
});

describe("everything else", () => {
  it("passes through", () => {
    expect(checkBashCommand("bun run test", behind)).toBeNull();
    expect(checkBashCommand("", behind)).toBeNull();
    expect(checkBashCommand("echo 'git add -A'", behind)).toBeNull();
  });
});

describe("removing from the index (decision 0050)", () => {
  const at = (command: string) => checkBashCommand(command, rebased, () => false);

  it("blocks a git rm that names no path of its own", () => {
    // Measured: three tracked files, one pathspec, three staged deletions.
    expect(at("git rm -r .")).not.toBeNull();
    expect(at("git rm -r --cached .")).not.toBeNull();
    expect(at("git rm --cached -r :/")).not.toBeNull();
    expect(at("sudo git rm -r .")).not.toBeNull();
  });

  it("allows a git rm that names what it removes", () => {
    expect(at("git rm src/gone.ts")).toBeNull();
    expect(at("git rm -r src/old/")).toBeNull();
    expect(at("git rm --cached src/secret.ts")).toBeNull();
  });

  it("leaves the reverse operation alone, which is how a mistake is undone", () => {
    for (const command of [
      "git reset",
      "git reset .",
      "git reset --hard HEAD",
      "git restore --staged .",
      "git restore --staged --worktree .",
    ]) {
      expect(at(command), command).toBeNull();
    }
  });
});
