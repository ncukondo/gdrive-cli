import { describe, expect, it } from "vitest";
import { checkBashCommand } from "./guard-bash.js";

const rebased = { rebased: true };
const behind = { rebased: false };

describe("staging the caller did not name (decisions 0001, 0048 §1)", () => {
  it("blocks every spelling the first review round got through", () => {
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
    ]) {
      expect(checkBashCommand(command, rebased), command).not.toBeNull();
    }
  });

  it("blocks every spelling the second round got through", () => {
    for (const command of [
      // `--` was read as "stop checking" rather than as 0048 §1's carve-out for
      // a file whose *name* is a flag. A `.` after it is as unnamed as before.
      "git add -- .",
      "git add -- :/",
      // Magic pathspecs and globs name the tree, not a file.
      "git add :/",
      "git add *.ts",
      "git add src/*",
      // A word in front of the binary, in every shape one can take.
      "sudo git add -A",
      "env git add -A",
      "/usr/bin/git add -A",
      "( git add -A )",
      "GIT_DIR=.git git add -A",
    ]) {
      expect(checkBashCommand(command, rebased), command).not.toBeNull();
    }
  });

  it("blocks a wrapper and a global option stacked together", () => {
    expect(checkBashCommand("sudo /usr/bin/git -C . stage -u", rebased)).not.toBeNull();
  });

  it("blocks the parent directory as well as the current one", () => {
    expect(checkBashCommand("git add ..", rebased)).not.toBeNull();
    expect(checkBashCommand("git add ../", rebased)).not.toBeNull();
  });

  it("blocks a combined short flag carrying A, u or a", () => {
    expect(checkBashCommand("git add -Av", rebased)).not.toBeNull();
    expect(checkBashCommand("git add -uv", rebased)).not.toBeNull();
    expect(checkBashCommand("git commit -av", rebased)).not.toBeNull();
  });

  it("sees past a global option that swallows its value", () => {
    expect(checkBashCommand("git -c core.hooksPath=/dev/null add -A", rebased)).not.toBeNull();
    expect(checkBashCommand("git --git-dir=.git add -A", rebased)).not.toBeNull();
  });

  it("does not fire on a message that merely mentions a flag", () => {
    expect(checkBashCommand('git commit -m "fix the -a flag"', rebased)).toBeNull();
    expect(checkBashCommand("git commit -m 'stop using git add -A'", rebased)).toBeNull();
  });

  it("leaves the flags that stage nothing alone", () => {
    expect(checkBashCommand("git commit --amend --no-edit", rebased)).toBeNull();
    expect(checkBashCommand("git commit --allow-empty -m x", rebased)).toBeNull();
    expect(checkBashCommand("git add -N src/new.ts", rebased)).toBeNull();
    expect(checkBashCommand("git add -p src/index.ts", rebased)).toBeNull();
  });

  it("blocks it inside a compound command", () => {
    expect(checkBashCommand("bun run lint && git add -A && git commit", rebased)).not.toBeNull();
    expect(checkBashCommand("cd sub; git add .", rebased)).not.toBeNull();
  });

  it("allows a specific path", () => {
    expect(checkBashCommand("git add src/index.ts", rebased)).toBeNull();
    expect(checkBashCommand("git add ./src", rebased)).toBeNull();
    expect(checkBashCommand("git add src/a.ts tests/b.ts", rebased)).toBeNull();
  });

  it("allows a file that is literally named -A, passed after --", () => {
    expect(checkBashCommand("git add -- -A", rebased)).toBeNull();
    expect(checkBashCommand("git add -- -A src/index.ts", rebased)).toBeNull();
  });

  it("allows --no-all, which is not --all", () => {
    expect(checkBashCommand("git add --no-all src/x.ts", rebased)).toBeNull();
  });

  it("says nothing about other git commands", () => {
    expect(checkBashCommand("git status", rebased)).toBeNull();
    expect(checkBashCommand("git diff .", rebased)).toBeNull();
    expect(checkBashCommand("git log -A", rebased)).toBeNull();
  });

  it("names the decision in the message", () => {
    expect(checkBashCommand("git add -A", rebased)?.message).toContain("0001");
  });
});

describe("requesting review before a rebase (decision 0044 §1)", () => {
  it("blocks gh pr create when main has moved past the branch", () => {
    expect(checkBashCommand("gh pr create --fill", behind)).not.toBeNull();
    expect(checkBashCommand("gh pr ready", behind)).not.toBeNull();
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
