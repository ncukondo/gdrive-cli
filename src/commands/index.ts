import type { Command } from "commander";

/**
 * Attaches every command area to the program. Each command task appends one
 * import + one registrar call here — this file is the only sanctioned shared
 * edit outside a task's own scope (decision 0013).
 *
 * Empty until the first command area lands.
 */
export function registerCommands(_program: Command): void {
  // Command areas are registered here as tasks land (auth, account, ls, ...).
}
