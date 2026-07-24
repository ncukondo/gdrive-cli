import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  chmodSync,
  readdirSync,
} from "node:fs";

/**
 * Injectable filesystem surface (decision 0012). Testable code depends on this
 * interface, never on `node:fs` directly; production wires {@link nodeFs},
 * tests pass an in-memory fake.
 *
 * `readdirSync` extends gcal-cli's shape: multi-account token discovery
 * (decision 0004) needs to enumerate `accounts/<email>.json` files.
 */
export interface FsAdapter {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string) => string;
  writeFileSync: (path: string, data: string) => void;
  mkdirSync: (path: string, options?: { recursive: boolean }) => void;
  unlinkSync: (path: string) => void;
  chmodSync: (path: string, mode: number) => void;
  readdirSync: (path: string) => string[];
}

export const nodeFs: FsAdapter = {
  existsSync: (path) => existsSync(path),
  readFileSync: (path) => readFileSync(path, "utf-8"),
  writeFileSync: (path, data) => writeFileSync(path, data, "utf-8"),
  mkdirSync: (path, options) => {
    mkdirSync(path, options);
  },
  unlinkSync: (path) => unlinkSync(path),
  chmodSync: (path, mode) => chmodSync(path, mode),
  readdirSync: (path) => readdirSync(path),
};
