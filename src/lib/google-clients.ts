import { google } from "googleapis";
import type { DriveClient } from "./api.ts";
import type { DocsClient } from "./docs-api.ts";
import type { SheetsClient } from "./sheets-api.ts";

type OAuth2Client = InstanceType<(typeof google.auth)["OAuth2"]>;

/**
 * The only place a generated googleapis client is turned into one of our port
 * interfaces (decision 0015). Each return-type annotation is a compile-time
 * check that the port still matches what googleapis generates — the check the
 * old `as unknown as DriveClient` casts threw away, and the reason a version
 * bump (task 0015) now fails `typecheck` instead of failing at runtime.
 *
 * Nothing else in the codebase imports `googleapis` for a client; unit tests
 * keep injecting the hand-written fakes (decision 0012).
 */
export function buildDriveClient(auth: OAuth2Client): DriveClient {
  return google.drive({ version: "v3", auth });
}

export function buildDocsClient(auth: OAuth2Client): DocsClient {
  return google.docs({ version: "v1", auth });
}

export function buildSheetsClient(auth: OAuth2Client): SheetsClient {
  return google.sheets({ version: "v4", auth });
}
