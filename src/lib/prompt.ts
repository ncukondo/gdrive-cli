import { createInterface } from "node:readline";
import type { PromptFn } from "./auth.ts";

/**
 * A readline-backed {@link PromptFn} for interactive credential entry.
 *
 * The question goes to **stderr**, not stdout. A prompt is addressed to a
 * person, and decision 0007 gives that stream to what a person reads and keeps
 * stdout for what a caller consumes — so `gdrive auth > token.json` puts
 * `Client ID:` on the terminal and the envelope in the file, instead of the
 * other way round with the terminal silent while the process waits for typing.
 * Decision 0059 §1 moves the consent URL for the same reason; this is the other
 * half of the same stream, and it is what makes "stdout holds the envelope
 * alone" true rather than nearly true.
 *
 * `input` stays stdin, which is where the typing arrives.
 */
export function createReadlinePrompt(): PromptFn {
  return (message: string) =>
    new Promise<string>((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      rl.question(message, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
}
