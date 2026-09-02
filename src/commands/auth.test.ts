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

/** Both sinks, kept apart: which stream a line lands on is the subject here. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function collectBoth() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    write: (m: string) => out.push(m),
    warn: (m: string) => err.push(m),
    get stdout() {
      return out.join("\n");
    },
    get stderr() {
      return err.join("\n");
    },
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
      canPrompt: true,
      noReader: undefined,
      quiet: false,
      write: out.write,
      warn: () => {},
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
      canPrompt: true,
      noReader: undefined,
      quiet: false,
      write: () => {},
      warn: () => {},
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
        canPrompt: false,
        noReader: undefined,
        quiet: false,
        write: () => {},
        warn: () => {},
        promptFn,
        runFlow,
        writeConfig: () => {},
      }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });

    expect(promptFn).not.toHaveBeenCalled();
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
      canPrompt: true,
      noReader: undefined,
      quiet: false,
      write: out.write,
      warn: out.write,
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

describe("handleAuthLogin: the flow needs a reader (issue #17, decision 0059)", () => {
  const base = {
    config: { default_format: "text" as const, accounts: [] },
    format: "text" as const,
    canPrompt: true,
    quiet: false,
    promptFn: async () => "",
    writeConfig: () => {},
  };

  /**
   * The *configured* machine is the one that hung: `canPrompt` guarded the
   * credential prompt, and a machine with `client_secret.json` already in place
   * sailed past it and blocked on the flow, which had no gate. `withClientSecret`
   * is the load-bearing part — with an empty fake fs this test passes against
   * the broken code, because the credential lookup throws first.
   */
  it("refuses before the flow, with credentials already in place", async () => {
    const io = collectBoth();
    const runFlow = vi.fn(async () => token("x@x.com"));

    await expect(
      handleAuthLogin({
        ...base,
        fs: withClientSecret(createFakeFs()),
        noReader: "no_terminal",
        write: io.write,
        warn: io.warn,
        runFlow,
      }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });

    expect(runFlow).not.toHaveBeenCalled();
    expect(io.stdout).toBe("");
    expect(io.stderr).toBe("");
  });

  /**
   * 0059 §5: one of the two is fixed by dropping a flag and the other is not, so
   * each message has to say which. The negative assertions are the point — a
   * single message naming both reasons satisfies `toContain` on both and is
   * exactly what the rule forbids.
   */
  it("tells a caller which of the two refused, and not the other", async () => {
    const deps = {
      ...base,
      fs: withClientSecret(createFakeFs()),
      write: () => {},
      warn: () => {},
      runFlow: async () => token("x@x.com"),
    };

    const terminal = messageOf(
      await handleAuthLogin({ ...deps, noReader: "no_terminal" }).catch((e: unknown) => e),
    );
    expect(terminal).toContain("terminal");
    expect(terminal).not.toContain("-f json");

    const flag = messageOf(
      await handleAuthLogin({ ...deps, noReader: "asked_for_json" }).catch((e: unknown) => e),
    );
    expect(flag).toContain("-f json");
    expect(flag).not.toContain("needs a terminal");
  });

  /**
   * The URL itself is asserted in `tests/integration/auth-streams.test.ts`, not
   * here. It is written in the registrar closure, which no test at this level
   * reaches — so a unit test would have to inject a `runFlow` fake and then
   * assert where that fake wrote, which is a test of the test. Measured: such a
   * test passed with production writing the URL to stdout.
   *
   * What *is* here is the notice on the same stream, because that one really
   * does go through `handleAuthLogin`.
   */
  it("prints the missing-client notice to stderr too", async () => {
    const io = collectBoth();

    await handleAuthLogin({
      ...base,
      fs: createFakeFs(),
      noReader: undefined,
      promptFn: async () => "typed",
      write: io.write,
      warn: io.warn,
      runFlow: async () => token("x@x.com"),
    });

    expect(io.stderr).toContain("No OAuth client configured");
    expect(io.stdout).not.toContain("No OAuth client configured");
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
