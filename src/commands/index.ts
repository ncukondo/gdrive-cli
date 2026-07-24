import type { Command } from "commander";
import { registerAuth } from "./auth.ts";

/**
 * Attaches every command area to the program. Each command task appends one
 * import + one registrar call here — this file is the only sanctioned shared
 * edit outside a task's own scope (decision 0013).
 */
export function registerCommands(program: Command): void {
  registerAuth(program);
}
