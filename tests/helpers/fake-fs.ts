import type { FsAdapter } from "../../src/lib/fs.ts";

/** An in-memory {@link FsAdapter} for unit tests, plus inspection handles. */
export interface FakeFs extends FsAdapter {
  /** path -> file contents */
  readonly files: Map<string, string>;
  /** directories created via mkdirSync */
  readonly dirs: Set<string>;
  /** path -> last chmod mode (to assert 0o600) */
  readonly chmods: Map<string, number>;
}

/**
 * Creates an in-memory filesystem fake. `initial` seeds files by absolute path.
 * `readdirSync` returns the immediate child names under a directory prefix.
 */
export function createFakeFs(initial: Record<string, string> = {}): FakeFs {
  const files = new Map<string, string>(Object.entries(initial));
  const dirs = new Set<string>();
  const chmods = new Map<string, number>();

  const hasChildren = (path: string): boolean => {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    for (const filePath of files.keys()) {
      if (filePath.startsWith(prefix)) return true;
    }
    return false;
  };

  return {
    files,
    dirs,
    chmods,
    // A path exists if it is a file, an explicitly created dir, or an implicit
    // dir (some seeded file lives under it).
    existsSync: (path) => files.has(path) || dirs.has(path) || hasChildren(path),
    readFileSync: (path) => {
      const content = files.get(path);
      if (content === undefined) {
        throw Object.assign(new Error(`ENOENT: no such file, open '${path}'`), { code: "ENOENT" });
      }
      return content;
    },
    writeFileSync: (path, data) => {
      files.set(path, data);
    },
    mkdirSync: (path) => {
      dirs.add(path);
    },
    unlinkSync: (path) => {
      files.delete(path);
    },
    chmodSync: (path, mode) => {
      chmods.set(path, mode);
    },
    readdirSync: (path) => {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const names = new Set<string>();
      for (const filePath of files.keys()) {
        if (filePath.startsWith(prefix)) {
          const rest = filePath.slice(prefix.length);
          if (rest !== "" && !rest.includes("/")) {
            names.add(rest);
          }
        }
      }
      return [...names];
    },
  };
}
