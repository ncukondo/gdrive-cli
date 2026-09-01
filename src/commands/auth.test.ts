import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAuthLogin, handleAuthLogout, handleAuthStatus } from "./auth.ts";
import { saveTokens, type ClientCredentials, type TokenData } from "../lib/auth.ts";
import { parseConfig, type Config } from "../lib/config.ts";
import { createFakeFs, type FakeFs } from "../../tests/helpers/fake-fs.ts";
import { callArgs } from "../../tests/helpers/mock.ts";

const HOME = "/home/test";
const CLIENT_SECRET = `${HOME}/.config/gdrive-cli/client_secret.json`;

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

const creds: ClientCredentials = {
  clientId: "id",
  clientSecret: "s",
  redirectUri: "http://localhost",
};

function withClientSecret(fs: FakeFs): FakeFs {
  fs.files.set(
    CLIENT_SECRET,
    JSON.stringify({ installed: { client_id: "id", client_secret: "s" } }),
  );
  return fs;
}

function token(email: string, overrides: Partial<TokenData> = {}): TokenData {
  return {
    email,
    access_token: "at",
    refresh_token: "rt",
    token_type: "Bearer",
    expiry_date: Date.parse("2026-07-24T13:00:00Z"),
    scopes: ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/documents"],
    ...overrides,
  };
}

function collect() {
  const lines: string[] = [];
  return {
    write: (m: string) => lines.push(m),
    get output() {
      return lines.join("\n");
    },
  };
}

describe("handleAuthStatus", () => {
  const config = parseConfig(`
default_account = "personal"
[[accounts]]
email = "me@gmail.com"
alias = "personal"
`);

  it("renders text with account, alias, default, expiry, and scopes", async () => {
    const fs = createFakeFs();
    saveTokens(fs, token("me@gmail.com"));
    const out = collect();
    const result = await handleAuthStatus({
      fs,
      config,
      format: "text",
      quiet: false,
      write: out.write,
    });
    expect(result.exitCode).toBe(0);
    expect(out.output).toContain("Account: me@gmail.com (alias: personal) [default]");
    expect(out.output).toContain("Scopes: drive, documents");
  });

  it("renders the JSON envelope per decision 0005", async () => {
    const fs = createFakeFs();
    saveTokens(fs, token("me@gmail.com"));
    const out = collect();
    await handleAuthStatus({ fs, config, format: "json", quiet: false, write: out.write });
    const parsed = JSON.parse(out.output);
    expect(parsed).toEqual({
      success: true,
      data: {
        authenticated: true,
        email: "me@gmail.com",
        alias: "personal",
        default: true,
        expires_at: "2026-07-24T13:00:00.000Z",
        scopes: ["drive", "documents"],
      },
    });
  });
});

describe("handleAuthLogin", () => {
  it("runs the flow and sets the first account as default", async () => {
    const fs = withClientSecret(createFakeFs());
    const config: Config = { default_format: "text", accounts: [] };
    const runFlow = vi.fn(async () => token("first@x.com"));
    const writeConfig = vi.fn((_config: Config) => {});
    const out = collect();

    const result = await handleAuthLogin({
      fs,
      config,
      format: "text",
      noPerson: undefined,
      quiet: false,
      write: out.write,
      promptFn: async () => "",
      runFlow,
      writeConfig,
    });

    expect(result.exitCode).toBe(0);
    expect(runFlow).toHaveBeenCalledWith(creds);
    expect(writeConfig).toHaveBeenCalledOnce();
    expect(writeConfig.mock.calls[0]?.[0].default_account).toBe("first@x.com");
    expect(out.output).toContain("Authenticated as first@x.com");
    expect(out.output).toContain("default");
  });

  it("does not set default when other accounts already exist", async () => {
    const fs = withClientSecret(createFakeFs());
    saveTokens(fs, token("existing@x.com"));
    const config: Config = { default_format: "text", accounts: [] };
    const writeConfig = vi.fn((_config: Config) => {});

    await handleAuthLogin({
      fs,
      config,
      format: "text",
      noPerson: undefined,
      quiet: false,
      write: () => {},
      promptFn: async () => "",
      runFlow: async () => token("second@x.com"),
      writeConfig,
    });

    expect(writeConfig).not.toHaveBeenCalled();
  });

  it("never prompts when the caller asked for JSON: throws AUTH_REQUIRED instead", async () => {
    const fs = createFakeFs(); // no client_secret, no env
    const promptFn = vi.fn(async () => "typed");
    const runFlow = vi.fn(async () => token("x@x.com"));

    await expect(
      handleAuthLogin({
        fs,
        config: { default_format: "text", accounts: [] },
        format: "json",
        noPerson: "asked_for_json",
        quiet: false,
        write: () => {},
        promptFn,
        runFlow,
        writeConfig: () => {},
      }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });

    expect(promptFn).not.toHaveBeenCalled();
    expect(runFlow).not.toHaveBeenCalled();
  });

  /**
   * Issue #17. The credential prompt was guarded and the browser flow under it
   * was not, so the *configured* machine — the one that gets past the prompt —
   * is the one that hung. `client_secret.json` present is what makes this
   * different from the case above, and it is why a test with an empty fake fs
   * could pass while the command blocked for ever.
   */
  it("refuses the browser flow with no terminal, even with credentials in place", async () => {
    const fs = withClientSecret(createFakeFs());
    const promptFn = vi.fn(async () => "typed");
    const runFlow = vi.fn(async () => token("x@x.com"));
    const out = collect();

    await expect(
      handleAuthLogin({
        fs,
        config: { default_format: "text", accounts: [] },
        format: "json",
        noPerson: "no_terminal",
        quiet: false,
        write: out.write,
        promptFn,
        runFlow,
        writeConfig: () => {},
      }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });

    expect(runFlow).not.toHaveBeenCalled();
    expect(promptFn).not.toHaveBeenCalled();
    // Nothing reaches stdout ahead of the error envelope: no URL line, no
    // "No OAuth client configured" notice (decision 0058 §3).
    expect(out.output).toBe("");
  });

  it("says a terminal is missing, and says the flag is when that is what refused", async () => {
    const fs = withClientSecret(createFakeFs());
    const base = {
      fs,
      config: { default_format: "text" as const, accounts: [] },
      format: "text" as const,
      quiet: false,
      write: () => {},
      promptFn: async () => "",
      runFlow: async () => token("x@x.com"),
      writeConfig: () => {},
    };

    await expect(handleAuthLogin({ ...base, noPerson: "no_terminal" })).rejects.toMatchObject({
      message: expect.stringContaining("terminal"),
    });
    await expect(handleAuthLogin({ ...base, noPerson: "asked_for_json" })).rejects.toMatchObject({
      message: expect.stringContaining("-f json"),
    });
  });

  /**
   * The path that already worked keeps working: no terminal and no credentials
   * is still `AUTH_REQUIRED` and still never reaches the flow. What changes is
   * only which of the two missing things the message names first.
   */
  it("still refuses with neither a terminal nor credentials", async () => {
    const runFlow = vi.fn(async () => token("x@x.com"));

    await expect(
      handleAuthLogin({
        fs: createFakeFs(),
        config: { default_format: "text", accounts: [] },
        format: "text",
        noPerson: "no_terminal",
        quiet: false,
        write: () => {},
        promptFn: async () => "",
        runFlow,
        writeConfig: () => {},
      }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });

    expect(runFlow).not.toHaveBeenCalled();
  });

  /**
   * Decision 0005 suppresses the prompt so automation gets `AUTH_REQUIRED`
   * rather than hanging, and it was written when JSON could only mean the
   * caller asked for it. A JSON default nobody named must not reach that
   * branch, or a fresh install cannot authenticate at all — which is the defect
   * class decision 0038 is about, one command over.
   */
  it("still prompts when JSON is only the default, and uses what was typed", async () => {
    const fs = createFakeFs();
    const promptFn = vi.fn(async () => "typed");
    const runFlow = vi.fn(async () => token("x@x.com"));
    const out = collect();

    const result = await handleAuthLogin({
      fs,
      config: { default_format: "text", accounts: [] },
      format: "json",
      noPerson: undefined,
      quiet: false,
      write: out.write,
      promptFn,
      runFlow,
      writeConfig: () => {},
    });

    expect(result.exitCode).toBe(0);
    expect(promptFn).toHaveBeenCalled();
    expect(runFlow).toHaveBeenCalledWith({
      clientId: "typed",
      clientSecret: "typed",
      redirectUri: "http://localhost",
    });
    expect(out.output).toContain("No OAuth client configured");
    expect(out.output).toContain('"authenticated": true');
  });
});

describe("handleAuthLogout", () => {
  it("revokes, deletes the token, and cleans the alias + default from config", async () => {
    const fs = createFakeFs();
    saveTokens(fs, token("me@gmail.com"));
    const config = parseConfig(`
default_account = "personal"
[[accounts]]
email = "me@gmail.com"
alias = "personal"
`);
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    const writeConfig = vi.fn((_config: Config) => {});
    const out = collect();

    const result = await handleAuthLogout({
      fs,
      config,
      format: "text",
      quiet: false,
      write: out.write,
      fetchFn,
      writeConfig,
      account: "personal",
    });

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(`${HOME}/.config/gdrive-cli/accounts/me@gmail.com.json`)).toBe(false);
    const [savedConfig] = callArgs(writeConfig);
    expect(savedConfig.accounts).toEqual([]);
    expect(savedConfig.default_account).toBeUndefined();
    expect(out.output).toContain("Logged out me@gmail.com");
  });

  it("throws ACCOUNT_NOT_FOUND for an unauthenticated account", async () => {
    await expect(
      handleAuthLogout({
        fs: createFakeFs(),
        config: { default_format: "text", accounts: [] },
        format: "text",
        quiet: false,
        write: () => {},
        fetchFn: async () => new Response(null),
        writeConfig: () => {},
        account: "ghost@x.com",
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
  });
});
