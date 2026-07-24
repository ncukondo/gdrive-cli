import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAccountViews,
  handleAccountAlias,
  handleAccountList,
  handleAccountRemove,
  handleAccountUse,
} from "./account.ts";
import { saveTokens, type TokenData } from "../lib/auth.ts";
import { parseConfig, type Config } from "../lib/config.ts";
import { createFakeFs, type FakeFs } from "../../tests/helpers/fake-fs.ts";
import { callArgs } from "../../tests/helpers/mock.ts";

const HOME = "/home/test";

let savedHome: string | undefined;
let savedAccount: string | undefined;

beforeEach(() => {
  savedHome = process.env["HOME"];
  savedAccount = process.env["GDRIVE_CLI_ACCOUNT"];
  process.env["HOME"] = HOME;
  delete process.env["GDRIVE_CLI_ACCOUNT"];
});

afterEach(() => {
  process.env["HOME"] = savedHome ?? "";
  if (savedAccount === undefined) delete process.env["GDRIVE_CLI_ACCOUNT"];
  else process.env["GDRIVE_CLI_ACCOUNT"] = savedAccount;
  vi.restoreAllMocks();
});

function token(email: string): TokenData {
  return {
    email,
    access_token: "at",
    refresh_token: "rt",
    token_type: "Bearer",
    expiry_date: 1,
    scopes: [],
  };
}

function fsWithAccounts(...emails: string[]): FakeFs {
  const fs = createFakeFs();
  for (const email of emails) saveTokens(fs, token(email));
  return fs;
}

function collect() {
  const lines: string[] = [];
  return {
    write: (m: string) => lines.push(m),
    get output() {
      return lines.join("\n");
    },
    get calls() {
      return lines.length;
    },
  };
}

const cfg = parseConfig(`
default_account = "personal"
[[accounts]]
email = "work@example.com"
alias = "work"
[[accounts]]
email = "me@gmail.com"
alias = "personal"
`);

describe("buildAccountViews", () => {
  it("merges tokens with config aliases and marks the default", () => {
    const views = buildAccountViews(cfg, ["work@example.com", "me@gmail.com"]);
    expect(views[0]).toEqual({
      email: "me@gmail.com",
      alias: "personal",
      default: true,
      authenticated: true,
    });
    const work = views.find((v) => v.email === "work@example.com");
    expect(work).toMatchObject({ alias: "work", default: false, authenticated: true });
  });

  it("includes config accounts without tokens as not authenticated", () => {
    const views = buildAccountViews(cfg, ["work@example.com"]);
    const me = views.find((v) => v.email === "me@gmail.com");
    expect(me?.authenticated).toBe(false);
  });
});

describe("handleAccountList", () => {
  it("renders text with a default marker and alias", async () => {
    const out = collect();
    await handleAccountList({
      fs: fsWithAccounts("work@example.com", "me@gmail.com"),
      config: cfg,
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(out.output).toContain("* me@gmail.com (personal)");
    expect(out.output).toContain("  work@example.com (work)");
  });

  it("renders JSON with accounts and default_account", async () => {
    const out = collect();
    await handleAccountList({
      fs: fsWithAccounts("me@gmail.com"),
      config: cfg,
      format: "json",
      quiet: false,
      write: out.write,
    });
    const parsed = JSON.parse(out.output);
    expect(parsed.data.default_account).toBe("personal");
    expect(
      parsed.data.accounts.find((a: { email: string }) => a.email === "me@gmail.com").default,
    ).toBe(true);
  });

  it("renders quiet as authenticated emails, one per line", async () => {
    const out = collect();
    await handleAccountList({
      fs: fsWithAccounts("me@gmail.com"),
      config: cfg,
      format: "text",
      quiet: true,
      write: out.write,
    });
    expect(out.output).toBe("me@gmail.com");
  });
});

describe("handleAccountUse", () => {
  it("sets default_account to the resolved email and persists", async () => {
    const writeConfig = vi.fn((_config: Config) => {});
    const out = collect();
    await handleAccountUse({
      fs: fsWithAccounts("work@example.com", "me@gmail.com"),
      config: cfg,
      ref: "work",
      format: "text",
      quiet: false,
      write: out.write,
      writeConfig,
    });
    expect(writeConfig.mock.calls[0]?.[0].default_account).toBe("work@example.com");
    expect(out.output).toBe("Default account set to work@example.com");
  });

  it("errors ACCOUNT_NOT_FOUND for an unauthenticated account", async () => {
    await expect(
      handleAccountUse({
        fs: fsWithAccounts("work@example.com"),
        config: cfg,
        ref: "personal",
        format: "text",
        quiet: false,
        write: () => {},
        writeConfig: () => {},
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
  });
});

describe("handleAccountAlias", () => {
  it("assigns an alias and persists", async () => {
    const writeConfig = vi.fn((_config: Config) => {});
    await handleAccountAlias({
      fs: fsWithAccounts("new@x.com"),
      config: { default_format: "text", accounts: [] },
      ref: "new@x.com",
      alias: "fresh",
      format: "text",
      quiet: false,
      write: () => {},
      writeConfig,
    });
    const [saved] = callArgs(writeConfig);
    expect(saved.accounts).toEqual([{ email: "new@x.com", alias: "fresh" }]);
  });

  it("rejects an alias already used by another account", async () => {
    await expect(
      handleAccountAlias({
        fs: fsWithAccounts("work@example.com", "me@gmail.com"),
        config: cfg,
        ref: "me@gmail.com",
        alias: "work",
        format: "text",
        quiet: false,
        write: () => {},
        writeConfig: () => {},
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
  });
});

describe("handleAccountRemove", () => {
  it("revokes, drops the config entry, and clears the default", async () => {
    const writeConfig = vi.fn((_config: Config) => {});
    const revoke = vi.fn(async () => {});
    const out = collect();
    await handleAccountRemove({
      fs: fsWithAccounts("me@gmail.com"),
      config: cfg,
      ref: "personal",
      format: "text",
      quiet: false,
      write: out.write,
      writeConfig,
      revoke,
    });
    expect(revoke).toHaveBeenCalledWith("me@gmail.com");
    const [saved] = callArgs(writeConfig);
    expect(saved.accounts.some((a) => a.email === "me@gmail.com")).toBe(false);
    expect(saved.default_account).toBeUndefined();
    expect(out.output).toBe("Removed me@gmail.com");
  });

  it("errors ACCOUNT_NOT_FOUND for an unknown account", async () => {
    await expect(
      handleAccountRemove({
        fs: createFakeFs(),
        config: { default_format: "text", accounts: [] },
        ref: "ghost@x.com",
        format: "text",
        quiet: false,
        write: () => {},
        writeConfig: () => {},
        revoke: async () => {},
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
  });
});
