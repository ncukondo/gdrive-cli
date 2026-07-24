import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  aliasForEmail,
  findAccount,
  findConfigPath,
  getDefaultConfigPath,
  loadConfig,
  parseConfig,
  parseTomlTable,
  resolveAccount,
  saveConfig,
  serializeConfig,
  setAlias,
  setDefaultAccount,
  type Config,
} from "./config.ts";
import { AppError } from "../types/index.ts";

/** In-memory fs fake covering the FsAdapter surface config.ts uses. */
function fakeFs(files: Record<string, string>) {
  const store = { ...files };
  const dirs = new Set<string>();
  return {
    store,
    dirs,
    existsSync: (p: string) => p in store,
    readFileSync: (p: string) => {
      const content = store[p];
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return content;
    },
    writeFileSync: (p: string, data: string) => {
      store[p] = data;
    },
    mkdirSync: (p: string) => {
      dirs.add(p);
    },
    unlinkSync: (p: string) => {
      delete store[p];
    },
    chmodSync: () => {},
    readdirSync: () => [],
  };
}

const ENV_KEY = "GDRIVE_CLI_CONFIG";
let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

describe("findConfigPath — resolution order", () => {
  const cwdPath = `${process.cwd()}/gdrive-cli.toml`;
  const defaultPath = getDefaultConfigPath();

  it("prefers the CLI path over everything", () => {
    process.env[ENV_KEY] = "/env.toml";
    const fs = fakeFs({ "/cli.toml": "", "/env.toml": "", [cwdPath]: "", [defaultPath]: "" });
    expect(findConfigPath(fs, "/cli.toml")).toBe("/cli.toml");
  });

  it("uses the env path when no CLI path is given", () => {
    process.env[ENV_KEY] = "/env.toml";
    const fs = fakeFs({ "/env.toml": "", [cwdPath]: "", [defaultPath]: "" });
    expect(findConfigPath(fs)).toBe("/env.toml");
  });

  it("falls back to ./gdrive-cli.toml before the default", () => {
    const fs = fakeFs({ [cwdPath]: "", [defaultPath]: "" });
    expect(findConfigPath(fs)).toBe(cwdPath);
  });

  it("uses the default path last", () => {
    const fs = fakeFs({ [defaultPath]: "" });
    expect(findConfigPath(fs)).toBe(defaultPath);
  });

  it("returns null when nothing exists", () => {
    expect(findConfigPath(fakeFs({}))).toBeNull();
  });

  it("throws CONFIG_ERROR when an explicit CLI path is missing", () => {
    expect(() => findConfigPath(fakeFs({}), "/nope.toml")).toThrow(AppError);
    expect(() => findConfigPath(fakeFs({}), "/nope.toml")).toThrow(/not found/);
  });

  it("throws CONFIG_ERROR when the env path is missing", () => {
    process.env[ENV_KEY] = "/env.toml";
    expect(() => findConfigPath(fakeFs({}))).toThrow(AppError);
  });
});

describe("parseConfig", () => {
  const toml = `
default_account = "work"
default_format = "json"

[[accounts]]
email = "work@example.com"
alias = "work"

[[accounts]]
email = "me@gmail.com"
`;

  it("parses default_account, default_format, and accounts", () => {
    const config = parseConfig(toml);
    expect(config.default_account).toBe("work");
    expect(config.default_format).toBe("json");
    expect(config.accounts).toEqual([
      { email: "work@example.com", alias: "work" },
      { email: "me@gmail.com" },
    ]);
  });

  it("returns empty defaults for an empty file", () => {
    const config = parseConfig("");
    expect(config).toEqual({ default_format: "text", accounts: [] });
  });

  it("defaults format to text when absent", () => {
    expect(parseConfig(`default_account = "x"`).default_format).toBe("text");
  });

  it("throws CONFIG_ERROR on malformed TOML", () => {
    expect(() => parseConfig("this is = = not toml")).toThrow(AppError);
  });

  it("throws CONFIG_ERROR on an invalid default_format", () => {
    expect(() => parseConfig(`default_format = "xml"`)).toThrow(/default_format/);
  });

  it("throws CONFIG_ERROR when an account lacks an email", () => {
    expect(() => parseConfig(`[[accounts]]\nalias = "x"`)).toThrow(AppError);
  });
});

describe("alias <-> email resolution", () => {
  const config = parseConfig(`
[[accounts]]
email = "work@example.com"
alias = "work"

[[accounts]]
email = "me@gmail.com"
`);

  it("resolves an alias to its canonical email", () => {
    expect(resolveAccount(config, "work")).toBe("work@example.com");
  });

  it("resolves an email to itself", () => {
    expect(resolveAccount(config, "work@example.com")).toBe("work@example.com");
  });

  it("passes through an unknown reference", () => {
    expect(resolveAccount(config, "ghost@x.com")).toBe("ghost@x.com");
  });

  it("maps an email back to its alias", () => {
    expect(aliasForEmail(config, "work@example.com")).toBe("work");
    expect(aliasForEmail(config, "me@gmail.com")).toBeUndefined();
  });

  it("finds an account by email or alias", () => {
    expect(findAccount(config, "work")?.email).toBe("work@example.com");
    expect(findAccount(config, "me@gmail.com")?.email).toBe("me@gmail.com");
    expect(findAccount(config, "unknown")).toBeUndefined();
  });
});

describe("loadConfig", () => {
  it("returns empty defaults when no config file exists", () => {
    const fs = fakeFs({});
    expect(loadConfig(fs, undefined)).toEqual({ default_format: "text", accounts: [] });
  });

  it("loads and parses the config at the CLI path", () => {
    const fs = fakeFs({ "/c.toml": `default_account = "work"` });
    expect(loadConfig(fs, "/c.toml").default_account).toBe("work");
  });
});

describe("write helpers", () => {
  it("round-trips and preserves unrelated keys", () => {
    const original = `
custom_key = "keep me"
default_format = "text"

[[accounts]]
email = "a@b.com"
alias = "a"
`;
    const raw = parseTomlTable(original);
    const config = setAlias(parseConfig(original), "a@b.com", "aa");
    const out = serializeConfig(config, raw);

    const reparsed = parseTomlTable(out);
    expect(reparsed["custom_key"]).toBe("keep me");
    const reconfig = parseConfig(out);
    expect(aliasForEmail(reconfig, "a@b.com")).toBe("aa");
  });

  it("setAlias adds a new account entry when the email is unknown", () => {
    const config: Config = { default_format: "text", accounts: [] };
    const updated = setAlias(config, "new@x.com", "n");
    expect(updated.accounts).toEqual([{ email: "new@x.com", alias: "n" }]);
    expect(config.accounts).toEqual([]); // original untouched
  });

  it("setDefaultAccount sets the default", () => {
    const config: Config = { default_format: "text", accounts: [] };
    expect(setDefaultAccount(config, "work").default_account).toBe("work");
  });

  it("saveConfig writes to the fake fs and creates the parent dir", () => {
    const fs = fakeFs({});
    const config: Config = {
      default_format: "json",
      default_account: "work",
      accounts: [{ email: "work@x.com", alias: "work" }],
    };
    saveConfig(fs, "/home/u/.config/gdrive-cli/config.toml", config);
    expect(fs.dirs.has("/home/u/.config/gdrive-cli")).toBe(true);
    const written = parseConfig(fs.store["/home/u/.config/gdrive-cli/config.toml"] ?? "");
    expect(written).toEqual(config);
  });

  it("saveConfig preserves unrelated keys already on disk", () => {
    const fs = fakeFs({ "/c.toml": `custom = "x"\ndefault_format = "text"\n` });
    saveConfig(fs, "/c.toml", { default_format: "json", accounts: [] });
    const reparsed = parseTomlTable(fs.store["/c.toml"] ?? "");
    expect(reparsed["custom"]).toBe("x");
    expect(reparsed["default_format"]).toBe("json");
  });
});
