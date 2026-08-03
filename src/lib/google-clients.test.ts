import { describe, expect, it } from "vitest";
import { google } from "googleapis";
import {
  buildDocsClient,
  buildDriveClient,
  buildFormsClient,
  buildSheetsClient,
} from "./google-clients.ts";

/**
 * The real check on these factories is `tsc`: each return-type annotation
 * compares our port interfaces against the googleapis-generated client, which
 * is what the old `as unknown as` casts prevented (decision 0015). These tests
 * add the runtime half — that the methods the ports promise actually exist on
 * the object googleapis hands back. No network: an unauthenticated OAuth2
 * client is enough to construct one.
 */
const auth = new google.auth.OAuth2();

describe("buildDriveClient", () => {
  it("exposes every file and permission method the port declares", () => {
    const drive = buildDriveClient(auth);
    for (const method of ["list", "get", "create", "copy", "update", "delete", "export"] as const) {
      expect(typeof drive.files[method]).toBe("function");
    }
    for (const method of ["list", "create", "update", "delete"] as const) {
      expect(typeof drive.permissions[method]).toBe("function");
    }
    expect(typeof drive.drives.list).toBe("function");
  });
});

describe("buildDocsClient", () => {
  it("exposes every document method the port declares", () => {
    const docs = buildDocsClient(auth);
    for (const method of ["get", "create", "batchUpdate"] as const) {
      expect(typeof docs.documents[method]).toBe("function");
    }
  });
});

describe("buildFormsClient", () => {
  it("exposes the form and response methods the port declares", () => {
    const forms = buildFormsClient(auth);
    expect(typeof forms.forms.get).toBe("function");
    expect(typeof forms.forms.responses.list).toBe("function");
  });
});

describe("buildSheetsClient", () => {
  it("exposes every spreadsheet method the port declares", () => {
    const sheets = buildSheetsClient(auth);
    for (const method of ["get", "create"] as const) {
      expect(typeof sheets.spreadsheets[method]).toBe("function");
    }
    for (const method of ["get", "update", "append", "clear"] as const) {
      expect(typeof sheets.spreadsheets.values[method]).toBe("function");
    }
  });
});
