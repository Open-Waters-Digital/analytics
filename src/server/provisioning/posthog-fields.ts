import "server-only";

/**
 * The PostHog fields provisioning reads and writes, and what their values mean.
 *
 * Confirmed on 25 September 2026 against Open Waters' own project (277423, EU),
 * read-only, with a personal API key scoped to that project (openspec change
 * add-provisioning, task 1.1). Nothing here is assumed from PostHog's docs.
 *
 * Endpoints, all under https://<region>.posthog.com/api:
 * - `projects/:id/`: GET for settings, PATCH for a partial update. The response
 *   also carries the project's secret tokens (`secret_api_token` and its
 *   backup), so a project response is never logged, stored or returned whole.
 * - `projects/:id/dashboards/`, `projects/:id/insights/`: list with `limit`,
 *   each object has `id`, `name`, `description`, `deleted` and `tags`. An
 *   insight lists the `dashboards` it is on.
 * - `projects/:id/cohorts/:id/`: needs `cohort:read`. The internal-traffic
 *   filter can point at a cohort. Provisioning never reads one: a cohort
 *   cannot match a host, so it is never a difference.
 * - `projects/:id/query/`: HogQL, needs `query:read`.
 * - `organizations/:id/`: `default_anonymize_ips` and the plan's
 *   `available_product_features`.
 * - `organizations/:id/proxy_records/`: needs `organization:read`. Returns
 *   `{ results, max_proxy_records }`; Open Waters' had none, limit 2, so a
 *   record's live status is taken as `status: "valid"` until the first proxy
 *   is set up and shows otherwise.
 *
 * Values:
 * - `cookieless_server_hash_mode`: 0 off, 1 stateless, 2 stateful. The project
 *   Open Waters switched on in the UI reads 2, so 2 is "on" as a partner sets
 *   it, and the value provisioning writes.
 * - `anonymize_ips`: boolean. True discards client IP data: of 33 events in 30
 *   days, none carried `$ip` (task 1.2).
 * - `timezone`: an IANA name. PostHog's default is "UTC".
 * - `app_urls`: the authorised URLs, an array of origins. Default empty.
 * - `session_recording_opt_in`: boolean. Open Waters' was true, a PostHog
 *   default the package's consent gate had been making harmless.
 * - `session_recording_masking_config`: null by default, an object when set.
 *   Its shape is not visible until something sets it, so `MASK_ALL_INPUTS` is
 *   confirmed by the first real apply at the Insights tier (task 7.1).
 * - `session_recording_retention_period`: a string such as "30d".
 * - `heatmaps_opt_in`: boolean.
 * - `test_account_filters`: an array of property filters. PostHog's default is
 *   a cohort ("Internal / Test users") matching person properties, which
 *   cookieless mode never creates, so it matches nobody.
 *
 * Tags on dashboards and insights are a paid feature: "tagging" was not among
 * the organisation's features, and every object's `tags` was empty. That is why
 * provisioned objects are matched by recorded id and a description marker
 * (design D2), not by tag.
 *
 * Insight bodies are `{ kind: "InsightVizNode", source }`, where `source` is a
 * `TrendsQuery` (`series` of `EventsNode` with `event` and `math`, `interval`,
 * `dateRange`, `breakdownFilter: { breakdown, breakdown_type }`,
 * `filterTestAccounts`) or a `FunnelsQuery`. Unique visitors are `math: "dau"`.
 */

export const PROJECT_FIELDS = {
  cookielessHashMode: "cookieless_server_hash_mode",
  anonymiseIps: "anonymize_ips",
  timezone: "timezone",
  authorisedUrls: "app_urls",
  recordingOptIn: "session_recording_opt_in",
  recordingMasking: "session_recording_masking_config",
  heatmaps: "heatmaps_opt_in",
  internalTrafficFilters: "test_account_filters",
} as const;

/** The value a partner's "on" produces in PostHog's settings screen. */
export const COOKIELESS_HASH_MODE_ON = 2;

/** Masking for the Insights tier: every input, whatever the site's own markup. */
export const MASK_ALL_INPUTS = { maskAllInputs: true } as const;

/** The marker a provisioned object carries in its PostHog description. */
export function descriptionMarker(contractKey: string): string {
  return `ow:${contractKey}`;
}

export const REQUIRED_SCOPES = [
  "project:write",
  "dashboard:write",
  "insight:write",
  "organization:read",
] as const;
