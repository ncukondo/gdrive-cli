#!/usr/bin/env bun
/**
 * PreToolUse shim: refuses a shell command that breaks a rule only reachable
 * before it runs (decisions 0001, 0044 §1, 0047 §1).
 *
 * The judgement is in `scripts/guard-bash.ts`, where it is tested against
 * literal command strings. This file does the two things a test cannot: read
 * the hook payload, and ask git whether the branch is rebased.
 */
import { checkBashCommand, isRebased } from "../../scripts/guard-bash.js";

interface HookPayload {
  tool_input?: { command?: unknown };
}

const raw = await Bun.stdin.text();
const parsed: unknown = raw.trim() === "" ? {} : JSON.parse(raw);
const payload: HookPayload = typeof parsed === "object" && parsed !== null ? parsed : {};

const command = payload.tool_input?.command;
if (typeof command === "string" && command !== "") {
  const block = checkBashCommand(command, { rebased: isRebased() });
  if (block !== null) {
    process.stderr.write(`${block.message}\n`);
    process.exit(2);
  }
}
