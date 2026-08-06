import { google } from "googleapis";
import type { docs_v1, drive_v3, forms_v1, sheets_v4, slides_v1 } from "googleapis";
import type { DriveClient } from "./api.ts";
import type { DocsClient, DocsRequest } from "./docs-api.ts";
import type { FormsClient } from "./forms-api.ts";
import type { SheetsClient } from "./sheets-api.ts";
import type { SlidesClient } from "./slides-api.ts";

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

/** Forms needs no new scope: `drive` covers it (decision 0027). */
export function buildFormsClient(auth: OAuth2Client): FormsClient {
  return google.forms({ version: "v1", auth });
}

/** Slides needs no new scope either (decision 0029). */
export function buildSlidesClient(auth: OAuth2Client): SlidesClient {
  return google.slides({ version: "v1", auth });
}

// --- Request-parameter guard ------------------------------------------------

/**
 * The return-type annotations above check the *response* half of each port: a
 * moved or renamed `data` field makes the generated client unassignable. They
 * do not check the *request* half. Assignability compares our params type
 * contravariantly against the generated one, and extra properties on our side
 * are not an error — so a parameter googleapis has dropped or renamed would
 * still compile, and we would send a key the API silently ignores. That is the
 * failure mode task 0015 was written to catch, so it gets its own check.
 *
 * The params come out of the ports themselves via `Parameters<…>`, so there is
 * no second list to keep in sync: every method a port declares is covered, and
 * adding one extends the guard automatically.
 */
type ParamsOf<M> = M extends (params: infer P, ...rest: never[]) => unknown ? P : never;

/** Resolves to `never` when every key we send still exists on `Generated`. */
type UnknownParams<M, Generated> = Exclude<keyof ParamsOf<M>, keyof Generated>;

/** Fails to instantiate — naming the offending key — when `K` is not `never`. */
type AssertNoUnknownParams<K extends never> = K;

type DriveFiles = DriveClient["files"];
type DriveDrives = DriveClient["drives"];
type DrivePermissions = DriveClient["permissions"];
type SheetsValues = SheetsClient["spreadsheets"]["values"];

export type GeneratedParamChecks = [
  AssertNoUnknownParams<UnknownParams<DriveFiles["list"], drive_v3.Params$Resource$Files$List>>,
  AssertNoUnknownParams<UnknownParams<DriveFiles["get"], drive_v3.Params$Resource$Files$Get>>,
  AssertNoUnknownParams<UnknownParams<DriveFiles["create"], drive_v3.Params$Resource$Files$Create>>,
  AssertNoUnknownParams<UnknownParams<DriveFiles["copy"], drive_v3.Params$Resource$Files$Copy>>,
  AssertNoUnknownParams<UnknownParams<DriveFiles["update"], drive_v3.Params$Resource$Files$Update>>,
  AssertNoUnknownParams<UnknownParams<DriveFiles["delete"], drive_v3.Params$Resource$Files$Delete>>,
  AssertNoUnknownParams<UnknownParams<DriveFiles["export"], drive_v3.Params$Resource$Files$Export>>,
  AssertNoUnknownParams<UnknownParams<DriveDrives["list"], drive_v3.Params$Resource$Drives$List>>,
  AssertNoUnknownParams<UnknownParams<DriveDrives["get"], drive_v3.Params$Resource$Drives$Get>>,
  AssertNoUnknownParams<
    UnknownParams<DrivePermissions["list"], drive_v3.Params$Resource$Permissions$List>
  >,
  AssertNoUnknownParams<
    UnknownParams<DrivePermissions["create"], drive_v3.Params$Resource$Permissions$Create>
  >,
  AssertNoUnknownParams<
    UnknownParams<DrivePermissions["update"], drive_v3.Params$Resource$Permissions$Update>
  >,
  AssertNoUnknownParams<
    UnknownParams<DrivePermissions["delete"], drive_v3.Params$Resource$Permissions$Delete>
  >,
  AssertNoUnknownParams<
    UnknownParams<DocsClient["documents"]["get"], docs_v1.Params$Resource$Documents$Get>
  >,
  AssertNoUnknownParams<
    UnknownParams<DocsClient["documents"]["create"], docs_v1.Params$Resource$Documents$Create>
  >,
  AssertNoUnknownParams<
    UnknownParams<
      DocsClient["documents"]["batchUpdate"],
      docs_v1.Params$Resource$Documents$Batchupdate
    >
  >,
  AssertNoUnknownParams<
    UnknownParams<FormsClient["forms"]["get"], forms_v1.Params$Resource$Forms$Get>
  >,
  AssertNoUnknownParams<
    UnknownParams<
      FormsClient["forms"]["responses"]["list"],
      forms_v1.Params$Resource$Forms$Responses$List
    >
  >,
  AssertNoUnknownParams<
    UnknownParams<SlidesClient["presentations"]["get"], slides_v1.Params$Resource$Presentations$Get>
  >,
  AssertNoUnknownParams<
    UnknownParams<SheetsClient["spreadsheets"]["get"], sheets_v4.Params$Resource$Spreadsheets$Get>
  >,
  AssertNoUnknownParams<
    UnknownParams<
      SheetsClient["spreadsheets"]["create"],
      sheets_v4.Params$Resource$Spreadsheets$Create
    >
  >,
  AssertNoUnknownParams<
    UnknownParams<SheetsValues["get"], sheets_v4.Params$Resource$Spreadsheets$Values$Get>
  >,
  AssertNoUnknownParams<
    UnknownParams<SheetsValues["update"], sheets_v4.Params$Resource$Spreadsheets$Values$Update>
  >,
  AssertNoUnknownParams<
    UnknownParams<SheetsValues["append"], sheets_v4.Params$Resource$Spreadsheets$Values$Append>
  >,
  AssertNoUnknownParams<
    UnknownParams<SheetsValues["clear"], sheets_v4.Params$Resource$Spreadsheets$Values$Clear>
  >,
];

/**
 * `UnknownParams` compares only the top-level keys of a params object, so the
 * request union we build *inside* `requestBody` is invisible to it. Task 0023
 * grew that union from two members to seven (decision 0021), and a renamed
 * field would otherwise reach the API as a request the server ignores.
 *
 * Assignability alone would not catch that — a *type* with an extra property is
 * still assignable, only a fresh object literal is not. So this repeats the
 * `UnknownParams` trick one level down: every member name must still be a key
 * of `Schema$Request`, and every field inside it a key of that member's schema.
 */
type UnknownRequestKeys<T> = T extends unknown
  ? {
      [K in keyof T]-?: K extends keyof docs_v1.Schema$Request
        ? Exclude<keyof T[K], keyof NonNullable<docs_v1.Schema$Request[K]>>
        : K;
    }[keyof T]
  : never;

export type DocsRequestChecks = [
  AssertNoUnknownParams<UnknownRequestKeys<DocsRequest>>,
  DocsRequest extends docs_v1.Schema$Request ? true : never,
];
