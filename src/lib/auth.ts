import http from "node:http";
import { google } from "googleapis";
import { AppError } from "../types/index.ts";
import type { FsAdapter } from "./fs.ts";

export type PromptFn = (message: string) => Promise<string>;
export type FetchFn = typeof globalThis.fetch;

export interface ClientCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Per-account token record stored at `accounts/<email>.json` (decision 0005). */
export interface TokenData {
  email: string;
  access_token: string;
  refresh_token: string;
  token_type: string;
  expiry_date: number;
  scopes: string[];
}

/** OAuth scopes requested at login (decision 0005). */
export const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/userinfo.email",
];

const DEFAULT_REDIRECT_URI = "http://localhost";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

type OAuth2Client = InstanceType<(typeof google.auth)["OAuth2"]>;

// --- Paths -----------------------------------------------------------------

export function getConfigDir(): string {
  const home = process.env["HOME"] ?? "";
  return `${home}/.config/gdrive-cli`;
}

export function getClientSecretPath(): string {
  return `${getConfigDir()}/client_secret.json`;
}

export function getAccountsDir(): string {
  return `${getConfigDir()}/accounts`;
}

export function getTokenPath(email: string): string {
  return `${getAccountsDir()}/${email}.json`;
}

// --- Client credentials ----------------------------------------------------

export function getClientCredentials(
  fs: Pick<FsAdapter, "existsSync" | "readFileSync">,
): ClientCredentials {
  const clientSecretPath = getClientSecretPath();
  if (fs.existsSync(clientSecretPath)) {
    const raw = JSON.parse(fs.readFileSync(clientSecretPath)) as {
      installed: { client_id: string; client_secret: string; redirect_uris?: string[] };
    };
    return {
      clientId: raw.installed.client_id,
      clientSecret: raw.installed.client_secret,
      redirectUri: raw.installed.redirect_uris?.[0] ?? DEFAULT_REDIRECT_URI,
    };
  }

  const clientId = process.env["GOOGLE_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  if (clientId && clientSecret) {
    return { clientId, clientSecret, redirectUri: DEFAULT_REDIRECT_URI };
  }

  throw new AppError(
    "AUTH_REQUIRED",
    "No OAuth client configured. Place client_secret.json in ~/.config/gdrive-cli/ or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
  );
}

export function saveClientCredentials(fs: FsAdapter, clientId: string, clientSecret: string): void {
  fs.mkdirSync(getConfigDir(), { recursive: true });
  const path = getClientSecretPath();
  const data = {
    installed: {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [DEFAULT_REDIRECT_URI],
    },
  };
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
  fs.chmodSync(path, 0o600);
}

export async function promptForClientCredentials(
  write: (msg: string) => void,
  promptFn: PromptFn,
): Promise<{ clientId: string; clientSecret: string }> {
  write("No OAuth client configured.");
  write("");
  write("To set up Google API access:");
  write("  1. Go to https://console.cloud.google.com");
  write("  2. Create a project and enable the Drive, Docs, and Sheets APIs");
  write("  3. Create OAuth 2.0 credentials (Desktop app)");
  write("  4. Paste the Client ID and Client Secret below");
  write("");

  const clientId = (await promptFn("Client ID: ")).trim();
  if (!clientId) throw new AppError("AUTH_REQUIRED", "Client ID is required.");
  const clientSecret = (await promptFn("Client Secret: ")).trim();
  if (!clientSecret) throw new AppError("AUTH_REQUIRED", "Client Secret is required.");
  return { clientId, clientSecret };
}

export async function getClientCredentialsOrPrompt(
  fs: FsAdapter,
  write: (msg: string) => void,
  promptFn: PromptFn,
): Promise<ClientCredentials> {
  try {
    return getClientCredentials(fs);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    const { clientId, clientSecret } = await promptForClientCredentials(write, promptFn);
    saveClientCredentials(fs, clientId, clientSecret);
    return { clientId, clientSecret, redirectUri: DEFAULT_REDIRECT_URI };
  }
}

// --- Token storage (per email) ---------------------------------------------

export function loadTokens(
  fs: Pick<FsAdapter, "existsSync" | "readFileSync">,
  email: string,
): TokenData | null {
  const path = getTokenPath(email);
  if (!fs.existsSync(path)) return null;
  return JSON.parse(fs.readFileSync(path)) as TokenData;
}

export function saveTokens(fs: FsAdapter, tokens: TokenData): void {
  fs.mkdirSync(getAccountsDir(), { recursive: true });
  const path = getTokenPath(tokens.email);
  fs.writeFileSync(path, JSON.stringify(tokens, null, 2));
  fs.chmodSync(path, 0o600);
}

/** Emails of all locally authenticated accounts (from `accounts/*.json`). */
export function listTokenEmails(fs: Pick<FsAdapter, "existsSync" | "readdirSync">): string[] {
  const dir = getAccountsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length));
}

// --- Refresh & client ------------------------------------------------------

export function isTokenExpired(expiryDate: number): boolean {
  return Date.now() >= expiryDate - EXPIRY_BUFFER_MS;
}

export async function refreshAccessToken(
  credentials: ClientCredentials,
  tokens: TokenData,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<TokenData> {
  const response = await fetchFn(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!response.ok) {
    throw new AppError(
      "AUTH_EXPIRED",
      `Failed to refresh token for ${tokens.email}. Re-run \`gdrive auth\`.`,
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
    token_type: string;
    refresh_token?: string;
  };

  return {
    email: tokens.email,
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? tokens.refresh_token,
    token_type: data.token_type,
    expiry_date: Date.now() + data.expires_in * 1000,
    scopes: tokens.scopes,
  };
}

/** Fetches the account email for an access token via the userinfo endpoint. */
export async function fetchUserEmail(
  accessToken: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<string> {
  const response = await fetchFn(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new AppError("API_ERROR", "Failed to fetch account email from userinfo.");
  }
  const data = (await response.json()) as { email?: string };
  if (!data.email) {
    throw new AppError("API_ERROR", "Userinfo response did not include an email.");
  }
  return data.email;
}

/**
 * Builds an authenticated OAuth2 client for `email`, refreshing (and persisting)
 * the token when it is near expiry. Missing token → `AUTH_REQUIRED`; failed
 * refresh → `AUTH_EXPIRED`.
 */
export async function getAuthenticatedClient(
  fs: FsAdapter,
  email: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<OAuth2Client> {
  const credentials = getClientCredentials(fs);
  const tokens = loadTokens(fs, email);
  if (!tokens) {
    throw new AppError("AUTH_REQUIRED", `No stored token for ${email}. Run \`gdrive auth\`.`);
  }

  let current = tokens;
  if (isTokenExpired(tokens.expiry_date)) {
    current = await refreshAccessToken(credentials, tokens, fetchFn);
    saveTokens(fs, current);
  }

  const client = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
    credentials.redirectUri,
  );
  client.setCredentials({
    access_token: current.access_token,
    refresh_token: current.refresh_token,
    token_type: current.token_type,
    expiry_date: current.expiry_date,
  });
  return client;
}

// --- OAuth login flow ------------------------------------------------------

export interface OAuthFlowResult {
  authUrl: string;
  /** Resolves to the saved token (email detected + persisted) once the browser redirects. */
  waitForToken: Promise<TokenData>;
  server: http.Server;
}

/**
 * Starts the loopback OAuth flow: binds an ephemeral port, returns the consent
 * URL, and resolves `waitForToken` after exchanging the code, detecting the
 * account email, and persisting the token.
 */
export async function startOAuthFlow(
  credentials: ClientCredentials,
  fs: FsAdapter,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<OAuthFlowResult> {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      const redirectUri = `http://localhost:${String(port)}`;

      const oauth2Client = new google.auth.OAuth2(
        credentials.clientId,
        credentials.clientSecret,
        redirectUri,
      );
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: OAUTH_SCOPES,
        prompt: "consent",
      });

      const waitForToken = new Promise<TokenData>((resolveToken, rejectToken) => {
        server.on("request", async (req, res) => {
          const url = new URL(req.url ?? "/", redirectUri);
          const code = url.searchParams.get("code");
          if (!code) {
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end("<html><body><h1>Error: no authorization code received.</h1></body></html>");
            return;
          }
          try {
            const tokenResponse = await fetchFn(GOOGLE_TOKEN_URL, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                code,
                client_id: credentials.clientId,
                client_secret: credentials.clientSecret,
                redirect_uri: redirectUri,
                grant_type: "authorization_code",
              }).toString(),
            });
            if (!tokenResponse.ok) {
              throw new AppError("AUTH_REQUIRED", "Failed to exchange authorization code.");
            }
            const data = (await tokenResponse.json()) as {
              access_token: string;
              refresh_token: string;
              expires_in: number;
              token_type: string;
              scope?: string;
            };
            const email = await fetchUserEmail(data.access_token, fetchFn);
            const tokens: TokenData = {
              email,
              access_token: data.access_token,
              refresh_token: data.refresh_token,
              token_type: data.token_type,
              expiry_date: Date.now() + data.expires_in * 1000,
              scopes: data.scope ? data.scope.split(" ") : OAUTH_SCOPES,
            };
            saveTokens(fs, tokens);
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(
              "<html><body><h1>Authentication successful!</h1><p>You can close this window.</p></body></html>",
            );
            resolveToken(tokens);
          } catch (err) {
            res.writeHead(500, { "Content-Type": "text/html" });
            res.end("<html><body><h1>Authentication failed.</h1></body></html>");
            rejectToken(err);
          }
        });
      });

      resolve({ authUrl, waitForToken, server });
    });
  });
}

/** Best-effort token revocation, then removes the local token file for `email`. */
export async function revokeTokens(
  fs: FsAdapter,
  email: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<void> {
  const tokens = loadTokens(fs, email);
  if (tokens) {
    try {
      await fetchFn(`${GOOGLE_REVOKE_URL}?token=${tokens.refresh_token}`, { method: "POST" });
    } catch {
      // Ignore revocation errors — still remove the local token.
    }
  }
  const path = getTokenPath(email);
  if (fs.existsSync(path)) {
    fs.unlinkSync(path);
  }
}
