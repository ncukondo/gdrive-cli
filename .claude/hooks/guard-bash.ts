/**
 * PreToolUse shim: refuses a shell command that breaks a rule only reachable
 * before it runs (decisions 0001, 0044 §1, 0047 §1).
 *
 * The judgement is in `scripts/guard-bash.ts`, where it is tested against
 * literal command strings. This file does the three things a test cannot: read
 * the hook payload, ask git whether the branch is rebased, and turn a block into
 * exit code 2.
 *
 * The guard call is wrapped, because a hook exits 0 to allow: an import that
 * fails or a git call that throws would let the command through with no signal.
 */
import { checkBashCommand, isRebased } from "../../scripts/guard-bash.js";
import { readToolInput, refuse } from "./payload.js";

const command = await readToolInput("guard-bash", ["command"]);

let blockMessage: string | null = null;
try {
  blockMessage = checkBashCommand(command, { rebased: isRebased() })?.message ?? null;
} catch (error) {
  refuse(
    `guard-bash: the guard itself failed (${error instanceof Error ? error.message : String(error)}).\n` +
      `Refusing rather than passing (decision 0047 §2).`,
  );
}
if (blockMessage !== null) refuse(blockMessage);
