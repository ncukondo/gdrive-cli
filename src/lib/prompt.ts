import { createInterface } from "node:readline";
import type { PromptFn } from "./auth.ts";

/** A readline-backed {@link PromptFn} for interactive credential entry. */
export function createReadlinePrompt(): PromptFn {
  return (message: string) =>
    new Promise<string>((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question(message, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
}
