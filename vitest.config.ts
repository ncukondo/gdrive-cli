import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // `scripts/` holds tooling rather than the CLI, but a script the release
    // depends on is tested like anything else, beside itself.
    include: ["src/**/*.test.ts", "tests/**/*.test.ts", "scripts/**/*.test.ts"],
    /**
     * The live suite is excluded here rather than by a flag on each script,
     * because a flag has to survive a shell and this does not (issue #18).
     * `--exclude 'tests/e2e/**'` is POSIX quoting, and `cmd.exe` does not treat
     * single quotes as quoting at all — it would hand vitest the literal
     * `'tests/e2e/**'`, which matches nothing, and `bun run test` on Windows
     * would reach for a real Google account. Only `pre-push` runs that suite
     * (decision 0043 §1), through `vitest.e2e.config.ts`.
     *
     * `configDefaults.exclude` is spread rather than replaced, because assigning
     * this key drops vitest's own `node_modules` and `dist` entries. That is
     * defensive rather than load-bearing today — `include` above is scoped to
     * `src`, `tests` and `scripts`, so nothing under `node_modules` is reachable
     * either way, measured — and it stops being defensive the moment `include`
     * widens.
     */
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
  },
});
