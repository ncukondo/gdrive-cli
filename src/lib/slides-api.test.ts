import { describe, expect, it } from "vitest";
import { createFakeSlides } from "../../tests/helpers/fake-slides.ts";
import { AppError } from "../types/index.ts";
import type { PresentationRaw } from "./slide-document.ts";
import { batchUpdatePresentation, createPresentation, getPresentation } from "./slides-api.ts";

/** The {@link AppError} code an awaited call raises. */
async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;
  }
  return "no error";
}

function googleError(code: number): Error & { code: number } {
  return Object.assign(new Error(`request failed with ${code}`), { code });
}

const presentation: PresentationRaw = {
  presentationId: "1PrEs",
  title: "Q3 review",
  slides: [{ objectId: "s1", slideProperties: { layoutObjectId: "L_BLANK" } }],
};

describe("getPresentation", () => {
  it("requests the presentation it was given and returns it", async () => {
    const fake = createFakeSlides({ presentation });
    expect(await getPresentation(fake.client, "1PrEs")).toEqual(presentation);
    expect(fake.calls).toEqual(["presentations.get"]);
    expect(fake.ids).toEqual(["1PrEs"]);
  });

  it("surfaces a 404 as NOT_FOUND and a 403 as PERMISSION_DENIED", async () => {
    const missing = createFakeSlides({ error: googleError(404) });
    expect(await codeOf(() => getPresentation(missing.client, "1PrEs"))).toBe("NOT_FOUND");
    const denied = createFakeSlides({ error: googleError(403) });
    expect(await codeOf(() => getPresentation(denied.client, "1PrEs"))).toBe("PERMISSION_DENIED");
  });
});

describe("createPresentation", () => {
  it("creates a deck with the title, and returns what the API made", async () => {
    const fake = createFakeSlides({
      created: {
        slides: [{ objectId: "p", slideProperties: { layoutObjectId: "L_T" } }],
        layouts: [{ objectId: "L_T", layoutProperties: { name: "TITLE" } }],
      },
    });
    const created = await createPresentation(fake.client, "Q4 review");
    expect(fake.calls).toEqual(["presentations.create"]);
    expect(fake.createdTitles).toEqual(["Q4 review"]);
    // The whole resource, because `create` needs the layouts and the default
    // slide it is about to reconcile (0030 §4).
    expect(created.presentationId).toBe("1NeWdEcK");
    expect(created.title).toBe("Q4 review");
    expect(created.slides).toHaveLength(1);
    expect(created.layouts).toHaveLength(1);
  });

  it("surfaces a failure through the shared error map", async () => {
    const fake = createFakeSlides({ error: googleError(403) });
    expect(await codeOf(() => createPresentation(fake.client, "Q4"))).toBe("PERMISSION_DENIED");
  });
});

describe("batchUpdatePresentation", () => {
  it("sends the requests to the presentation, with no writeControl by default", async () => {
    const fake = createFakeSlides();
    await batchUpdatePresentation(fake.client, "1PrEs", [{ deleteObject: { objectId: "s1" } }]);
    expect(fake.calls).toEqual(["presentations.batchUpdate"]);
    expect(fake.batches[0]).toEqual({
      presentationId: "1PrEs",
      requestBody: { requests: [{ deleteObject: { objectId: "s1" } }] },
    });
  });

  it("requires the revision the document was read at when it carries one (0028 §5)", async () => {
    const fake = createFakeSlides();
    await batchUpdatePresentation(fake.client, "1PrEs", [], "abc123");
    expect(fake.batches[0]?.requestBody.writeControl).toEqual({ requiredRevisionId: "abc123" });
  });

  it("says the deck moved on when the API refuses the required revision", async () => {
    const conflict = Object.assign(new Error("required revision ID does not match"), { code: 400 });
    const fake = createFakeSlides({ batchError: conflict });
    let message = "";
    try {
      await batchUpdatePresentation(fake.client, "1PrEs", [], "abc123");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("abc123");
    expect(message).toContain("Read the presentation again");
  });

  it("leaves an unrelated 400 as an API error, so nobody re-reads for nothing", async () => {
    const fake = createFakeSlides({ batchError: googleError(400) });
    expect(await codeOf(() => batchUpdatePresentation(fake.client, "1PrEs", [], "abc123"))).toBe(
      "API_ERROR",
    );
  });
});
