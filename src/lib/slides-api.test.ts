import { describe, expect, it } from "vitest";
import { createFakeSlides } from "../../tests/helpers/fake-slides.ts";
import { AppError } from "../types/index.ts";
import type { PresentationRaw } from "./slide-document.ts";
import { getPresentation } from "./slides-api.ts";

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
