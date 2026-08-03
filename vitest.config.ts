import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // `scripts/` holds tooling rather than the CLI, but a script the release
    // depends on is tested like anything else, beside itself.
    include: ["src/**/*.test.ts", "tests/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
