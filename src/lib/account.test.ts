import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listAuthenticatedAccounts, resolveAccountEmail } from "./account.ts";
import { parseConfig, type Config } from "./config.ts";
import { AppError } from "../types/index.ts";
import { createFakeFs } from "../../tests/helpers/fake-fs.ts";

const HOME = "/home/test";
const ACCOUNTS_DIR = `${HOME}/.config/gdrive-cli/accounts`;

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
});

function fsWithAccounts(...emails: string[]) {
  const files: Record<string, string> = {};
  for (const email of emails) files[`${ACCOUNTS_DIR}/${email}.json`] = "{}";
  return createFakeFs(files);
}

const emptyConfig: Config = { default_format: "text", accounts: [] };

describe("listAuthenticatedAccounts", () => {
  it("lists emails from token files", () => {
    const fs = fsWithAccounts("a@x.com", "b@y.com");
    expect(listAuthenticatedAccounts(fs).sort()).toEqual(["a@x.com", "b@y.com"]);
  });
});

describe("resolveAccountEmail — priority order", () => {
  const configWithAlias = parseConfig(`
default_account = "personal"

[[accounts]]
email = "work@example.com"
alias = "work"

[[accounts]]
email = "me@gmail.com"
alias = "personal"
`);

  it("1) uses the requested -a option (alias resolved) above all", () => {
    process.env["GDRIVE_CLI_ACCOUNT"] = "me@gmail.com";
    const fs = fsWithAccounts("work@example.com", "me@gmail.com");
    expect(resolveAccountEmail(fs, configWithAlias, "work")).toBe("work@example.com");
  });

  it("2) uses $GDRIVE_CLI_ACCOUNT when no -a is given", () => {
    process.env["GDRIVE_CLI_ACCOUNT"] = "work";
    const fs = fsWithAccounts("work@example.com", "me@gmail.com");
    expect(resolveAccountEmail(fs, configWithAlias)).toBe("work@example.com");
  });

  it("3) uses default_account when no -a and no env", () => {
    const fs = fsWithAccounts("work@example.com", "me@gmail.com");
    expect(resolveAccountEmail(fs, configWithAlias)).toBe("me@gmail.com");
  });

  it("4) uses the sole account when nothing selects one", () => {
    const fs = fsWithAccounts("only@x.com");
    expect(resolveAccountEmail(fs, emptyConfig)).toBe("only@x.com");
  });

  it("throws ACCOUNT_NOT_FOUND for a named but unauthenticated account", () => {
    const fs = fsWithAccounts("work@example.com");
    expect(() => resolveAccountEmail(fs, configWithAlias, "personal")).toThrow(AppError);
    try {
      resolveAccountEmail(fs, configWithAlias, "personal");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      if (e instanceof AppError) expect(e.code).toBe("ACCOUNT_NOT_FOUND");
    }
  });

  it("throws AUTH_REQUIRED when no accounts are authenticated", () => {
    expect(() => resolveAccountEmail(createFakeFs(), emptyConfig)).toThrow(
      expect.objectContaining({ code: "AUTH_REQUIRED" }),
    );
  });

  it("throws ACCOUNT_NOT_FOUND when multiple accounts exist and none is selected", () => {
    const fs = fsWithAccounts("a@x.com", "b@y.com");
    expect(() => resolveAccountEmail(fs, emptyConfig)).toThrow(
      expect.objectContaining({ code: "ACCOUNT_NOT_FOUND" }),
    );
  });
});
