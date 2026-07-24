import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchUserEmail,
  getAuthenticatedClient,
  getClientCredentials,
  getTokenPath,
  isTokenExpired,
  listTokenEmails,
  loadTokens,
  refreshAccessToken,
  revokeTokens,
  saveClientCredentials,
  saveTokens,
  type ClientCredentials,
  type TokenData,
} from "./auth.ts";
import { AppError } from "../types/index.ts";
import { createFakeFs } from "../../tests/helpers/fake-fs.ts";

const HOME = "/home/test";
const CONFIG_DIR = `${HOME}/.config/gdrive-cli`;
const ACCOUNTS_DIR = `${CONFIG_DIR}/accounts`;

let savedHome: string | undefined;
let savedId: string | undefined;
let savedSecret: string | undefined;

beforeEach(() => {
  savedHome = process.env["HOME"];
  savedId = process.env["GOOGLE_CLIENT_ID"];
  savedSecret = process.env["GOOGLE_CLIENT_SECRET"];
  process.env["HOME"] = HOME;
  delete process.env["GOOGLE_CLIENT_ID"];
  delete process.env["GOOGLE_CLIENT_SECRET"];
});

afterEach(() => {
  process.env["HOME"] = savedHome ?? "";
  if (savedId === undefined) delete process.env["GOOGLE_CLIENT_ID"];
  else process.env["GOOGLE_CLIENT_ID"] = savedId;
  if (savedSecret === undefined) delete process.env["GOOGLE_CLIENT_SECRET"];
  else process.env["GOOGLE_CLIENT_SECRET"] = savedSecret;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const creds: ClientCredentials = {
  clientId: "id",
  clientSecret: "secret",
  redirectUri: "http://localhost",
};

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), { status: ok ? 200 : 400 });
}

function token(email: string, overrides: Partial<TokenData> = {}): TokenData {
  return {
    email,
    access_token: "at",
    refresh_token: "rt",
    token_type: "Bearer",
    expiry_date: 9_999_999_999_999,
    scopes: ["https://www.googleapis.com/auth/drive"],
    ...overrides,
  };
}

describe("getClientCredentials", () => {
  it("reads client_secret.json (installed shape)", () => {
    const fs = createFakeFs({
      [`${CONFIG_DIR}/client_secret.json`]: JSON.stringify({
        installed: {
          client_id: "cid",
          client_secret: "csec",
          redirect_uris: ["http://localhost:1"],
        },
      }),
    });
    expect(getClientCredentials(fs)).toEqual({
      clientId: "cid",
      clientSecret: "csec",
      redirectUri: "http://localhost:1",
    });
  });

  it("falls back to GOOGLE_CLIENT_ID/SECRET env vars", () => {
    process.env["GOOGLE_CLIENT_ID"] = "envid";
    process.env["GOOGLE_CLIENT_SECRET"] = "envsec";
    expect(getClientCredentials(createFakeFs())).toMatchObject({
      clientId: "envid",
      clientSecret: "envsec",
    });
  });

  it("throws AUTH_REQUIRED when nothing is configured", () => {
    expect(() => getClientCredentials(createFakeFs())).toThrow(AppError);
    try {
      getClientCredentials(createFakeFs());
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      if (e instanceof AppError) expect(e.code).toBe("AUTH_REQUIRED");
    }
  });
});

describe("saveClientCredentials", () => {
  it("writes the installed shape chmod 600", () => {
    const fs = createFakeFs();
    saveClientCredentials(fs, "cid", "csec");
    const path = `${CONFIG_DIR}/client_secret.json`;
    expect(JSON.parse(fs.files.get(path) ?? "").installed.client_id).toBe("cid");
    expect(fs.chmods.get(path)).toBe(0o600);
  });
});

describe("token storage", () => {
  it("round-trips a token per email at accounts/<email>.json with chmod 600", () => {
    const fs = createFakeFs();
    const t = token("me@gmail.com");
    saveTokens(fs, t);
    const path = getTokenPath("me@gmail.com");
    expect(path).toBe(`${ACCOUNTS_DIR}/me@gmail.com.json`);
    expect(fs.chmods.get(path)).toBe(0o600);
    expect(loadTokens(fs, "me@gmail.com")).toEqual(t);
  });

  it("loadTokens returns null when the file is absent", () => {
    expect(loadTokens(createFakeFs(), "nobody@x.com")).toBeNull();
  });

  it("loadTokens rejects an unparseable token file with AUTH_REQUIRED", () => {
    const fs = createFakeFs({ [getTokenPath("me@x.com")]: "{ not json" });
    expect(() => loadTokens(fs, "me@x.com")).toThrow(
      /Stored credentials for me@x.com are unreadable/,
    );
  });

  it("loadTokens rejects a token file missing required fields", () => {
    const fs = createFakeFs({
      [getTokenPath("me@x.com")]: JSON.stringify({ email: "me@x.com", access_token: "at" }),
    });
    try {
      loadTokens(fs, "me@x.com");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      if (error instanceof AppError) expect(error.code).toBe("AUTH_REQUIRED");
    }
  });

  it("listTokenEmails lists emails and ignores non-json files", () => {
    const fs = createFakeFs({
      [`${ACCOUNTS_DIR}/a@x.com.json`]: "{}",
      [`${ACCOUNTS_DIR}/b@y.com.json`]: "{}",
      [`${ACCOUNTS_DIR}/README.txt`]: "x",
    });
    expect(listTokenEmails(fs).sort()).toEqual(["a@x.com", "b@y.com"]);
  });

  it("listTokenEmails is empty when the accounts dir is absent", () => {
    expect(listTokenEmails(createFakeFs())).toEqual([]);
  });
});

describe("isTokenExpired", () => {
  it("is true within the 5-minute buffer and false well before", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const now = Date.now();
    expect(isTokenExpired(now + 60_000)).toBe(true); // within buffer
    expect(isTokenExpired(now + 10 * 60_000)).toBe(false); // beyond buffer
  });
});

describe("refreshAccessToken", () => {
  it("returns a new token preserving email, refresh_token, and scopes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const fetchFn = vi.fn(async () =>
      jsonResponse({ access_token: "new-at", expires_in: 3600, token_type: "Bearer" }),
    );
    const result = await refreshAccessToken(creds, token("me@x.com"), fetchFn);
    expect(result.access_token).toBe("new-at");
    expect(result.email).toBe("me@x.com");
    expect(result.refresh_token).toBe("rt");
    expect(result.scopes).toEqual(["https://www.googleapis.com/auth/drive"]);
    expect(result.expiry_date).toBe(Date.now() + 3600 * 1000);
  });

  it("throws AUTH_EXPIRED when refresh fails", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: "invalid_grant" }, false));
    await expect(refreshAccessToken(creds, token("me@x.com"), fetchFn)).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
    });
  });
});

describe("fetchUserEmail", () => {
  it("returns the email from userinfo", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ email: "who@x.com" }));
    expect(await fetchUserEmail("at", fetchFn)).toBe("who@x.com");
  });

  it("throws API_ERROR on a non-ok response", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, false));
    await expect(fetchUserEmail("at", fetchFn)).rejects.toMatchObject({
      code: "API_ERROR",
    });
  });
});

describe("getAuthenticatedClient", () => {
  function fsWithClient() {
    return createFakeFs({
      [`${CONFIG_DIR}/client_secret.json`]: JSON.stringify({
        installed: { client_id: "cid", client_secret: "csec", redirect_uris: ["http://localhost"] },
      }),
    });
  }

  it("throws AUTH_REQUIRED when there is no token for the email", async () => {
    await expect(getAuthenticatedClient(fsWithClient(), "me@x.com")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("returns a client with the stored access token when not expired", async () => {
    const fs = fsWithClient();
    saveTokens(fs, token("me@x.com", { access_token: "live-at" }));
    const client = await getAuthenticatedClient(fs, "me@x.com");
    expect(client.credentials.access_token).toBe("live-at");
  });

  it("refreshes and persists when the token is expired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const fs = fsWithClient();
    saveTokens(fs, token("me@x.com", { access_token: "old", expiry_date: Date.now() - 1000 }));
    const fetchFn = vi.fn(async () =>
      jsonResponse({ access_token: "refreshed", expires_in: 3600, token_type: "Bearer" }),
    );
    const client = await getAuthenticatedClient(fs, "me@x.com", fetchFn);
    expect(client.credentials.access_token).toBe("refreshed");
    // persisted
    expect(loadTokens(fs, "me@x.com")?.access_token).toBe("refreshed");
  });
});

describe("revokeTokens", () => {
  it("calls the revoke endpoint and deletes the token file", async () => {
    const fs = createFakeFs();
    saveTokens(fs, token("me@x.com"));
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    await revokeTokens(fs, "me@x.com", fetchFn);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(fs.existsSync(getTokenPath("me@x.com"))).toBe(false);
  });

  it("does not throw when there is no token file", async () => {
    const fetchFn = vi.fn();
    await expect(revokeTokens(createFakeFs(), "ghost@x.com", fetchFn)).resolves.toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
