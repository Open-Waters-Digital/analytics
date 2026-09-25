import { descriptionMarker } from "./posthog-fields";
import type { DesiredInsight, DesiredSetting } from "./desired";

/**
 * The difference between a PostHog project and what the contract requires
 * (add-provisioning, design D2 and D3). Pure: it takes what was read and
 * returns what to change.
 */

export interface SettingDifference {
  type: "setting";
  field: string;
  label: string;
  current: unknown;
  required: unknown;
  held: boolean;
}

export interface FilterDifference {
  type: "filter";
  /** The filter list with the conditions that hide the production site removed. */
  remaining: unknown[];
  removed: number;
}

export interface DashboardDifference {
  type: "dashboard";
  change: "missing";
}

export interface InsightDifference {
  type: "insight";
  key: string;
  name: string;
  change: "missing" | "changed" | "not_on_dashboard";
  /** The matched PostHog insight, when there is one. */
  posthogId: number | null;
}

export type Difference =
  SettingDifference | FilterDifference | DashboardDifference | InsightDifference;

/** Every difference except held ones, which apply skips. */
export function toApply(differences: Difference[]): Difference[] {
  return differences.filter(d => !(d.type === "setting" && d.held));
}

// ---------------------------------------------------------------- settings

function normaliseOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map(item => {
      try {
        return new URL(item).origin;
      } catch {
        return item;
      }
    })
    .sort();
}

export function settingDifferences(
  project: Record<string, unknown>,
  desired: DesiredSetting[],
): SettingDifference[] {
  const differences: SettingDifference[] = [];
  for (const setting of desired) {
    const current = project[setting.field];
    const same =
      setting.field === "app_urls"
        ? JSON.stringify(normaliseOrigins(current)) ===
          JSON.stringify(normaliseOrigins(setting.value))
        : isSubset(setting.value, current);
    if (!same) {
      differences.push({
        type: "setting",
        field: setting.field,
        label: setting.label,
        current: current ?? null,
        required: setting.value,
        held: setting.held,
      });
    }
  }
  return differences;
}

// ------------------------------------------------------ internal-traffic filter

interface FilterCondition {
  key?: unknown;
  type?: unknown;
  operator?: unknown;
  value?: unknown;
}

/**
 * Whether an event from the production site would survive this condition.
 * PostHog keeps an event only when it satisfies every condition in the filter,
 * so a host or URL condition that a production event fails hides the whole
 * site. Cohort and person conditions cannot see a host, and neither can an
 * operator this function does not know: both count as passing.
 */
export function productionPasses(condition: FilterCondition, productionUrl: string): boolean {
  if (condition.type === "cohort" || condition.type === "person") return true;
  const url = new URL(productionUrl);
  let subject: string;
  if (condition.key === "$host") subject = url.host;
  else if (condition.key === "$current_url") subject = url.href;
  else return true;

  const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(String);
  const lower = subject.toLowerCase();
  switch (condition.operator) {
    case "exact":
      return values.includes(subject);
    case "is_not":
      return !values.includes(subject);
    case "icontains":
      return values.some(value => lower.includes(value.toLowerCase()));
    case "not_icontains":
      return !values.some(value => lower.includes(value.toLowerCase()));
    case "regex":
      return values.some(value => safeRegex(value)?.test(subject) ?? true);
    case "not_regex":
      return !values.some(value => safeRegex(value)?.test(subject) ?? false);
    default:
      return true;
  }
}

function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

export function filterDifference(filters: unknown, productionUrl: string): FilterDifference | null {
  if (!Array.isArray(filters)) return null;
  const remaining = filters.filter(condition =>
    productionPasses((condition ?? {}) as FilterCondition, productionUrl),
  );
  const removed = filters.length - remaining.length;
  return removed > 0 ? { type: "filter", remaining, removed } : null;
}

// ----------------------------------------------------------- matching objects

export interface PostHogObject {
  id: number;
  description?: string | null;
  deleted?: boolean;
  /** Insights only: the dashboards the insight is on. */
  dashboards?: number[];
  query?: unknown;
}

export interface RecordedObject {
  contractKey: string;
  posthogId: number;
}

export interface Match<T extends PostHogObject> {
  object: T | null;
  /** True when found by its description marker rather than a recorded id. */
  adopted: boolean;
}

/**
 * Finds the PostHog object for a contract key: the recorded id first, then the
 * description marker (design D2). A deleted object does not match.
 */
export function matchObject<T extends PostHogObject>(
  contractKey: string,
  recorded: RecordedObject[],
  objects: T[],
): Match<T> {
  const live = objects.filter(object => !object.deleted);
  const record = recorded.find(row => row.contractKey === contractKey);
  if (record) {
    const byId = live.find(object => object.id === record.posthogId);
    if (byId) return { object: byId, adopted: false };
  }
  const marker = descriptionMarker(contractKey);
  const byMarker = live.find(object =>
    (object.description ?? "").split("\n").some(line => line.trim() === marker),
  );
  return byMarker ? { object: byMarker, adopted: true } : { object: null, adopted: false };
}

export function insightDifferences(
  desired: DesiredInsight[],
  recorded: RecordedObject[],
  insights: PostHogObject[],
  dashboardId: number | null,
): InsightDifference[] {
  const differences: InsightDifference[] = [];
  for (const insight of desired) {
    const { object } = matchObject(insight.key, recorded, insights);
    if (!object) {
      differences.push({
        type: "insight",
        key: insight.key,
        name: insight.name,
        change: "missing",
        posthogId: null,
      });
    } else if (!isSubset(insight.query, object.query)) {
      differences.push({
        type: "insight",
        key: insight.key,
        name: insight.name,
        change: "changed",
        posthogId: object.id,
      });
    } else if (dashboardId !== null && !(object.dashboards ?? []).includes(dashboardId)) {
      differences.push({
        type: "insight",
        key: insight.key,
        name: insight.name,
        change: "not_on_dashboard",
        posthogId: object.id,
      });
    }
  }
  return differences;
}

// --------------------------------------------------------------- comparison

/**
 * True when everything in `required` is present in `actual` with the same
 * value. Objects may carry extra keys, which is how PostHog's added defaults
 * are ignored (design D3). Arrays must match in length, element by element.
 */
export function isSubset(required: unknown, actual: unknown): boolean {
  if (required === actual) return true;
  if (Array.isArray(required)) {
    return (
      Array.isArray(actual) &&
      actual.length === required.length &&
      required.every((item, index) => isSubset(item, actual[index]))
    );
  }
  if (required !== null && typeof required === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(required).every(([key, value]) =>
      isSubset(value, (actual as Record<string, unknown>)[key]),
    );
  }
  return false;
}
