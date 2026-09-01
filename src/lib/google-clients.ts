import { google } from "googleapis";
import type { docs_v1, drive_v3, forms_v1, sheets_v4, slides_v1 } from "googleapis";
import type { DriveClient, FileCreateBody, FileUpdateBody, PermissionBody } from "./api.ts";
import type { DocsClient, DocsRequest } from "./docs-api.ts";
import type { FormsClient, FormsRequest } from "./forms-api.ts";
import type { SheetsClient } from "./sheets-api.ts";
import type { SlidesClient, SlidesRequest } from "./slides-api.ts";

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
    UnknownParams<FormsClient["forms"]["create"], forms_v1.Params$Resource$Forms$Create>
  >,
  AssertNoUnknownParams<
    UnknownParams<FormsClient["forms"]["batchUpdate"], forms_v1.Params$Resource$Forms$Batchupdate>
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
    UnknownParams<
      SlidesClient["presentations"]["create"],
      slides_v1.Params$Resource$Presentations$Create
    >
  >,
  AssertNoUnknownParams<
    UnknownParams<
      SlidesClient["presentations"]["batchUpdate"],
      slides_v1.Params$Resource$Presentations$Batchupdate
    >
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
 * of the API's `Schema$Request`, and every field inside it a key of that
 * member's schema.
 *
 * **Both sides need `NonNullable`, and for different reasons.** The generated
 * schema makes every field nullable, so `keyof Schema[K]` without it is the
 * keys of `X | null`, which is `never`. Ours makes some fields *optional*, and
 * `keyof T[K]` on `X | undefined` is `never` for exactly the same reason — so
 * an optional field's inner keys were checked against nothing and every one of
 * them passed. `FileCreateBody["shortcutDetails"]` is that shape, and it is
 * what issue #29 asked for; the missing `NonNullable` is why adding the check
 * without this line still let a misspelled `targetId` through.
 */
type UnknownRequestKeys<T, Schema> = T extends unknown
  ? {
      [K in keyof T]-?: K extends keyof Schema
        ? Exclude<keyof NonNullable<T[K]>, keyof NonNullable<Schema[K]>>
        : K;
    }[keyof T]
  : never;

/**
 * The same guard for the three bodies this CLI sends to Drive (issue #29).
 *
 * `GeneratedParamChecks` above compares only the top-level keys of a params
 * object, and `requestBody` is one such key — so everything inside it has been
 * unchecked since these ports were written. `FileCreateBody` gained
 * `shortcutDetails.targetId` (decision 0026) and compiled unguarded, which is
 * the class decision 0015 and task 0016 set these checks up to catch; 0026 §6
 * says the guard covers it and was wrong, and issue #29 is that correction.
 *
 * `UnknownRequestKeys` is reused unchanged. Its name says "request" because
 * Docs, Forms and Slides send a union of request members, but nothing in it is
 * union-specific: `T extends unknown` is a no-op distribution over an interface,
 * and what is left is exactly the two checks a body needs — every key of ours
 * is a key of the generated schema, and every key one level down is a key of
 * that field's schema. One level is as far as it goes, which is enough for
 * every body here and would not be for a deeper one.
 *
 * The assignability half is the companion, not a duplicate: the key check
 * catches a name the schema does not have, and `extends` catches a type that
 * does not fit the name.
 */
export type DriveBodyChecks = [
  AssertNoUnknownParams<UnknownRequestKeys<FileCreateBody, drive_v3.Schema$File>>,
  FileCreateBody extends drive_v3.Schema$File ? true : never,
  AssertNoUnknownParams<UnknownRequestKeys<FileUpdateBody, drive_v3.Schema$File>>,
  FileUpdateBody extends drive_v3.Schema$File ? true : never,
  AssertNoUnknownParams<UnknownRequestKeys<PermissionBody, drive_v3.Schema$Permission>>,
  PermissionBody extends drive_v3.Schema$Permission ? true : never,
];

export type DocsRequestChecks = [
  AssertNoUnknownParams<UnknownRequestKeys<DocsRequest, docs_v1.Schema$Request>>,
  DocsRequest extends docs_v1.Schema$Request ? true : never,
];

/**
 * The same guard for Forms (decision 0028). It matters more here than for Docs:
 * a field name the API ignores is how an `updateMask` silently stops protecting
 * the field it was written to protect.
 */
export type FormsRequestChecks = [
  AssertNoUnknownParams<UnknownRequestKeys<FormsRequest, forms_v1.Schema$Request>>,
  FormsRequest extends forms_v1.Schema$Request ? true : never,
];

/**
 * The same guard for Slides (decision 0030). A deck is edited by object id, so
 * a field name the API ignores is how a `deleteText` silently clears nothing
 * and the `insertText` after it doubles the text instead of replacing it.
 */
export type SlidesRequestChecks = [
  AssertNoUnknownParams<UnknownRequestKeys<SlidesRequest, slides_v1.Schema$Request>>,
  SlidesRequest extends slides_v1.Schema$Request ? true : never,
];
