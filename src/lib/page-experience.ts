/**
 * Core Web Vitals verdicts (add-page-experience, design D6). Pure and free of
 * any server import, so the rules are unit tested and the client page can use
 * the labels.
 */

/** Google's "good" thresholds at the 75th percentile, and the lab score floor. */
export interface Targets {
  lcpMs: number;
  inpMs: number;
  cls: number;
  labScore: number;
}

export const GOOD: Targets = { lcpMs: 2_500, inpMs: 200, cls: 0.1, labScore: 90 };

export interface Budget {
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  labScore: number | null;
}

export interface FieldValues {
  status: "ok" | "not_enough_data" | "failed";
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
}

export type MetricVerdict = "pass" | "fail" | "not_reported";

export interface Verdict {
  outcome: "passing" | "failing" | "not_enough_data" | "no_data";
  metrics: { lcp: MetricVerdict; inp: MetricVerdict; cls: MetricVerdict };
  /** The metrics outside their target, for "failing on LCP". */
  failing: ("LCP" | "INP" | "CLS")[];
}

export function targets(budget: Budget | null): Targets {
  return {
    lcpMs: budget?.lcpMs ?? GOOD.lcpMs,
    inpMs: budget?.inpMs ?? GOOD.inpMs,
    cls: budget?.cls ?? GOOD.cls,
    labScore: budget?.labScore ?? GOOD.labScore,
  };
}

function judge(value: number | null, target: number): MetricVerdict {
  if (value === null) return "not_reported";
  return value <= target ? "pass" : "fail";
}

/**
 * A form factor's verdict from its latest origin field row. INP can be missing
 * for a site with few interactions while LCP and CLS are present: the verdict
 * then judges the two it has, rather than failing or passing on a gap.
 */
export function verdictFor(field: FieldValues | null, budget: Budget | null): Verdict {
  const none: Verdict["metrics"] = {
    lcp: "not_reported",
    inp: "not_reported",
    cls: "not_reported",
  };
  if (!field || field.status === "failed")
    return { outcome: "no_data", metrics: none, failing: [] };
  if (field.status === "not_enough_data")
    return { outcome: "not_enough_data", metrics: none, failing: [] };

  const goal = targets(budget);
  const metrics = {
    lcp: judge(field.lcpMs, goal.lcpMs),
    inp: judge(field.inpMs, goal.inpMs),
    cls: judge(field.cls, goal.cls),
  };
  const failing = (
    [
      ["LCP", metrics.lcp],
      ["INP", metrics.inp],
      ["CLS", metrics.cls],
    ] as const
  )
    .filter(([, verdict]) => verdict === "fail")
    .map(([name]) => name);
  const judged = Object.values(metrics).filter(verdict => verdict !== "not_reported");
  if (judged.length === 0) return { outcome: "no_data", metrics, failing };
  return { outcome: failing.length > 0 ? "failing" : "passing", metrics, failing };
}

/** A lab score against its target: below it is marked, as one run on its date. */
export function labBelowTarget(score: number | null, budget: Budget | null): boolean {
  return score !== null && score < targets(budget).labScore;
}
