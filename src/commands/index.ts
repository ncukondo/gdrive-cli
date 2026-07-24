import type { Command } from "commander";
import { registerAuth } from "./auth.ts";
import { registerAccount } from "./account.ts";
import { registerInit } from "./init.ts";
import { registerDriveRead } from "./drive-read.ts";
import { registerDriveWrite } from "./drive-write.ts";
import { registerShare } from "./share/index.ts";
import { registerDocs } from "./docs/index.ts";
import { registerSheets } from "./sheets/index.ts";

/**
 * Attaches every command area to the program. Each command task appends one
 * import + one registrar call here — this file is the only sanctioned shared
 * edit outside a task's own scope (decision 0013).
 */
export function registerCommands(program: Command): void {
  registerAuth(program);
  registerAccount(program);
  registerInit(program);
  registerDriveRead(program);
  registerDriveWrite(program);
  registerShare(program);
  registerDocs(program);
  registerSheets(program);
}
