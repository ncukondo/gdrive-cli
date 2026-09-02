import { defineConfig } from "vitest/config";

/**
 * The live suite, and only it (decision 0043 §1).
 *
 * It needs its own file rather than a flag because a config-level `exclude` in
 * `vitest.config.ts` cannot be undone from the command line — measured: with
 * `tests/e2e/**` excluded there, `vitest run tests/e2e` collects nothing, and a
 * CLI `--exclude` adds to that list rather than replacing it. A positional
 * filter selects from what the config already collected, so the only way to run
 * what the default config refuses is a config that does not refuse it.
 *
 * Nothing here is quoted or globbed by a shell, which is the point (issue #18).
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/e2e/**/*.test.ts"],
  },
});
