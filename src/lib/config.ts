import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { z } from "zod";
import { AppError, type OutputFormat } from "../types/index.ts";
import type { FsAdapter } from "./fs.ts";

/**
 * One entry of the `[[accounts]]` alias registry (decision 0006). `email` is
 * canonical (matches `accounts/<email>.json`); `alias` is optional and
 * interchangeable with the email on the CLI.
 */
export interface AccountEntry {
  email: string;
  alias?: string;
}

/** Parsed, typed view of `config.toml`. Token material never lives here. */
export interface Config {
  default_account?: string;
  default_format: OutputFormat;
  accounts: AccountEntry[];
}

type DiscoverFs = Pick<FsAdapter, "existsSync">;

export function getDefaultConfigPath(): string {
  const home = process.env["HOME"] ?? "";
  return `${home}/.config/gdrive-cli/config.toml`;
}

/**
 * Resolves the config path per decision 0006:
 * `--config` > `$GDRIVE_CLI_CONFIG` > `./gdrive-cli.toml` > default.
 * An explicitly requested path (CLI or env) that is missing is a `CONFIG_ERROR`;
 * the implicit cwd/default locations are simply skipped when absent.
 * Returns `null` when no config exists anywhere.
 */
export function findConfigPath(fs: DiscoverFs, cliPath?: string): string | null {
  if (cliPath) {
    if (!fs.existsSync(cliPath)) {
      throw new AppError("CONFIG_ERROR", `Config file not found: ${cliPath}`);
    }
    return cliPath;
  }

  const envPath = process.env["GDRIVE_CLI_CONFIG"];
  if (envPath) {
    if (!fs.existsSync(envPath)) {
      throw new AppError("CONFIG_ERROR", `Config file not found: ${envPath}`);
    }
    return envPath;
  }

  const cwdPath = `${process.cwd()}/gdrive-cli.toml`;
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }

  const defaultPath = getDefaultConfigPath();
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }

  return null;
}

function validateFormat(value: string): OutputFormat {
  if (value !== "text" && value !== "json") {
    throw new AppError(
      "CONFIG_ERROR",
      `Invalid default_format "${value}" in config. Must be "text" or "json".`,
    );
  }
  return value;
}

/** Any TOML table: the untyped shape every config read starts from (0015). */
const TableSchema = z.record(z.string(), z.unknown());

/** Parses TOML into a plain table. Throws `TomlError` on malformed input. */
export function parseTomlTable(toml: string): Record<string, unknown> {
  return TableSchema.parse(parseToml(toml));
}

function toAccountEntry(raw: unknown, index: number): AccountEntry {
  const table = TableSchema.safeParse(raw);
  if (!table.success) {
    throw new AppError("CONFIG_ERROR", `Invalid [[accounts]] entry at index ${index}`);
  }
  const email = table.data["email"];
  if (typeof email !== "string" || email === "") {
    throw new AppError("CONFIG_ERROR", `[[accounts]] entry at index ${index} is missing "email"`);
  }
  const entry: AccountEntry = { email };
  const alias = table.data["alias"];
  if (typeof alias === "string" && alias !== "") {
    entry.alias = alias;
  }
  return entry;
}

/** Parses config TOML into a typed {@link Config}. Malformed TOML → `CONFIG_ERROR`. */
export function parseConfig(toml: string): Config {
  let raw: Record<string, unknown>;
  if (toml.trim() === "") {
    raw = {};
  } else {
    try {
      raw = parseTomlTable(toml);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError("CONFIG_ERROR", `Failed to parse config: ${message}`);
    }
  }

  const accounts = Array.isArray(raw["accounts"])
    ? raw["accounts"].map((entry, i) => toAccountEntry(entry, i))
    : [];

  // A command that is not told otherwise emits its machine representation
  // (decision 0036 §1); `default_format = "text"` is how a person at a terminal
  // moves it back.
  const default_format =
    typeof raw["default_format"] === "string" ? validateFormat(raw["default_format"]) : "json";

  const config: Config = { default_format, accounts };
  if (typeof raw["default_account"] === "string") {
    config.default_account = raw["default_account"];
  }
  return config;
}

/** Loads and parses config from the resolved path; missing file → empty defaults. */
export function loadConfig(
  fs: Pick<FsAdapter, "existsSync" | "readFileSync">,
  cliPath?: string,
): Config {
  const path = findConfigPath(fs, cliPath);
  if (!path) {
    return parseConfig("");
  }
  return parseConfig(fs.readFileSync(path));
}

/** Finds an account entry by email or alias. */
export function findAccount(config: Config, ref: string): AccountEntry | undefined {
  return config.accounts.find((a) => a.email === ref || a.alias === ref);
}

/** Resolves an alias-or-email reference to its canonical email (pass-through if unknown). */
export function resolveAccount(config: Config, ref: string): string {
  return findAccount(config, ref)?.email ?? ref;
}

/** Returns the alias for a canonical email, if one is registered. */
export function aliasForEmail(config: Config, email: string): string | undefined {
  return config.accounts.find((a) => a.email === email)?.alias;
}

/** Returns a copy of `config` with `alias` assigned to `email` (adding the entry if new). */
export function setAlias(config: Config, email: string, alias: string): Config {
  const accounts = config.accounts.map((a) => ({ ...a }));
  const existing = accounts.find((a) => a.email === email);
  if (existing) {
    existing.alias = alias;
  } else {
    accounts.push({ email, alias });
  }
  return { ...config, accounts };
}

/** Returns a copy of `config` with `default_account` set. */
export function setDefaultAccount(config: Config, ref: string): Config {
  return { ...config, default_account: ref };
}

/**
 * Serializes {@link Config} to TOML. `base` (typically the raw parse of the
 * existing file) is merged in first so unrelated keys survive a round-trip
 * (comments are not preserved by the TOML serializer).
 */
export function serializeConfig(config: Config, base: Record<string, unknown> = {}): string {
  const out: Record<string, unknown> = { ...base };
  if (config.default_account !== undefined) {
    out["default_account"] = config.default_account;
  } else {
    delete out["default_account"];
  }
  out["default_format"] = config.default_format;
  out["accounts"] = config.accounts.map((a) =>
    a.alias !== undefined ? { email: a.email, alias: a.alias } : { email: a.email },
  );
  return stringifyToml(out);
}

/**
 * Writes `config` to `path`, preserving unrelated keys from the file already at
 * `path`. Creates the parent directory if needed.
 */
export function saveConfig(fs: FsAdapter, path: string, config: Config): void {
  let base: Record<string, unknown> = {};
  if (fs.existsSync(path)) {
    try {
      base = parseTomlTable(fs.readFileSync(path));
    } catch {
      base = {};
    }
  } else {
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (dir !== "") {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  fs.writeFileSync(path, serializeConfig(config, base));
}
