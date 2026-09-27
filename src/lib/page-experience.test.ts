import { describe, expect, it } from "vitest";
import { labBelowTarget, verdictFor, type Budget, type FieldValues } from "./page-experience";

const field = (values: Partial<FieldValues> = {}): FieldValues => ({
  status: "ok",
  lcpMs: 1_900,
  inpMs: 120,
  cls: 0.02,
  ...values,
});
const noBudget = null;

describe("verdictFor", () => {
  it("passes a site inside Google's thresholds with no budget", () => {
    expect(verdictFor(field(), noBudget)).toEqual({
      outcome: "passing",
      metrics: { lcp: "pass", inp: "pass", cls: "pass" },
      failing: [],
    });
  });

  it("fails LCP against a stricter budget even though Google rates it good", () => {
    const budget: Budget = { lcpMs: 2_000, inpMs: null, cls: null, labScore: null };
    expect(verdictFor(field({ lcpMs: 2_300 }), budget)).toMatchObject({
      outcome: "failing",
      failing: ["LCP"],
    });
    expect(verdictFor(field({ lcpMs: 2_300 }), noBudget).outcome).toBe("passing");
  });

  it("judges LCP and CLS when INP is missing, and says INP is not reported", () => {
    expect(verdictFor(field({ inpMs: null }), noBudget)).toEqual({
      outcome: "passing",
      metrics: { lcp: "pass", inp: "not_reported", cls: "pass" },
      failing: [],
    });
  });

  it("says there is not enough data rather than failing a small site", () => {
    expect(verdictFor(field({ status: "not_enough_data" }), noBudget).outcome).toBe(
      "not_enough_data",
    );
  });

  it("gives no verdict it has no data for", () => {
    expect(verdictFor(null, noBudget).outcome).toBe("no_data");
    expect(verdictFor(field({ status: "failed" }), noBudget).outcome).toBe("no_data");
  });

  it("names every failing metric", () => {
    expect(verdictFor(field({ inpMs: 350, cls: 0.3 }), noBudget).failing).toEqual(["INP", "CLS"]);
  });
});

describe("labBelowTarget", () => {
  it("marks a score below 90, or below a site's own target", () => {
    expect(labBelowTarget(89, null)).toBe(true);
    expect(labBelowTarget(92, null)).toBe(false);
    expect(labBelowTarget(92, { lcpMs: null, inpMs: null, cls: null, labScore: 95 })).toBe(true);
    expect(labBelowTarget(null, null)).toBe(false);
  });
});
