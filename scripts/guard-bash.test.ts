import { describe, expect, it } from "vitest";
import { checkBashCommand } from "./guard-bash.js";

const rebased = { rebased: true };
const behind = { rebased: false };

describe("staging everything (decision 0001)", () => {
  it("blocks the three spellings", () => {
    expect(checkBashCommand("git add -A", rebased)).not.toBeNull();
    expect(checkBashCommand("git add .", rebased)).not.toBeNull();
    expect(checkBashCommand("git add --all", rebased)).not.toBeNull();
  });

  it("blocks a combined short flag carrying A", () => {
    expect(checkBashCommand("git add -Av", rebased)).not.toBeNull();
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
