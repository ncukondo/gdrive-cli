#!/usr/bin/env bun
/**
 * PreToolUse shim: refuses an edit to a committed decision before it is written
 * (decisions 0032 §3, 0047 §1–§2).
 *
 * `scripts/lint-records.ts` catches the same thing at commit time and is what
 * binds a person. This exists because an agent that has already rewritten a
 * record has lost the text, and because the fix — a new number stating its own
 * position in full — is a different piece of work from the edit it was about to
 * make, not a correction to it.
 *
 * There is no bypass here on purpose. 0047 §2 puts 0032 §3's typo exception in
 * a person's hands, where `git commit --no-verify` reaches it.
 */
import { execFileSync } from "node:child_process";
import { relative } from "node:path";
import { isDecisionRecord } from "../../scripts/lint-records.js";

interface HookPayload {
  tool_input?: { file_path?: unknown; notebook_path?: unknown };
}

function targetPath(payload: HookPayload): string | null {
  const input = payload.tool_input ?? {};
  const candidate = input.file_path ?? input.notebook_path;
  return typeof candidate === "string" && candidate !== "" ? candidate : null;
}

function isTracked(path: string): boolean {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", path], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const raw = await Bun.stdin.text();
const parsed: unknown = raw.trim() === "" ? {} : JSON.parse(raw);
const payload: HookPayload = typeof parsed === "object" && parsed !== null ? parsed : {};

const target = targetPath(payload);
if (target !== null) {
  const repoRelative = relative(process.cwd(), target);
  if (isDecisionRecord(repoRelative) && isTracked(repoRelative)) {
    process.stderr.write(
      `${repoRelative} is a committed decision, and 0032 §3 does not allow it to change —\n` +
        `not its Decision, not its Context, not its Status line, and not a table or a\n` +
        `list inside it. A record that may be edited must be edited to stay true, and\n` +
        `each place needing an edit is a place the edit can be missed.\n\n` +
        `Write the new position as a new decision, stating itself in full so it reads\n` +
        `without the one it replaces, with a Status line naming the relationship:\n\n` +
        `  Status: accepted — revises [NNNN](NNNN-slug.md) §N\n` +
        `  Status: accepted — extends [NNNN](NNNN-slug.md)\n\n` +
        `Then add its row to decisions/README.md, which is where that relationship is\n` +
        `visible without opening either file (0032 §4).\n\n` +
        `A typo or a broken link is the only exception and is a person's to make.\n`,
    );
    process.exit(2);
  }
}
