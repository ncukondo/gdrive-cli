import { describe, expect, it } from "vitest";
import { refusedPlan } from "./prune-refusal.ts";
import { renderError } from "./output.ts";

/**
 * The refusal payload is tested without a command around it for the reason
 * `after-create.test.ts` is: it is a shape two command families depend on
 * agreeing about, and it is the half of a failure a caller parses.
 */
describe("refusedPlan", () => {
  const deletions = [
    { action: "delete", id: "i2", title: "Watch this", index: 1 },
    { action: "delete", id: "i3", title: "Anything else?", index: 2 },
  ];

  it("is the success envelope's data with applied false", () => {
    expect(refusedPlan("1FoRm", deletions).payload).toEqual({
      id: "1FoRm",
      plan: deletions,
      applied: false,
    });
  });

  it("gives -q one id per line, which is what $(…) can take", () => {
    expect(refusedPlan("1FoRm", deletions).quiet).toBe("i2\ni3");
  });

  /**
   * A form item the form gave no id is deleted by position, so there is no id
   * to print. It must not become a blank line: a caller reading `-q` into a
   * list would get an empty element that names nothing.
   */
  it("skips an entry with no id rather than printing an empty line", () => {
    const anonymous: { action: string; id?: string; title: string; index: number }[] = [
      { action: "delete", title: "No id here", index: 3 },
    ];
    expect(refusedPlan("1FoRm", anonymous).quiet).toBe("");
    expect(refusedPlan("1FoRm", [...deletions, ...anonymous]).quiet).toBe("i2\ni3");
  });

  /**
   * The message already names the items (0028 §3), so a summary under it would
   * be the same list twice. Asserted through what a reader actually sees rather
   * than through the absence of a field: `renderError` is what turns the two
   * into lines, and it is the thing that would change if a `text` were added.
   */
  it("leaves the error one line in text mode, rather than repeating the list", () => {
    const rendered = renderError(
      "PRUNE_REQUIRED",
      "Applying this document would delete 2 items",
      "text",
      false,
      refusedPlan("1FoRm", deletions),
    );
    expect(rendered.stderr).toBe("Error: Applying this document would delete 2 items\n");
    expect(rendered.stdout).toBe("");
  });

  /**
   * `FormRaw.formId` and `PresentationRaw.presentationId` are both
   * `?: string | null` in `lib/form-document.ts` and `lib/slide-document.ts` —
   * the projections, not the API params — so this branch is reachable from the
   * types the planners actually hold. Without the guard the payload would carry
   * `"id": null`, which is a field a caller has to special-case rather than one
   * they can test for.
   */
  it("omits the id when the API did not return one", () => {
    expect(refusedPlan(undefined, deletions).payload).toEqual({
      plan: deletions,
      applied: false,
    });
    expect(refusedPlan(null, deletions).payload).toEqual({ plan: deletions, applied: false });
  });
});
