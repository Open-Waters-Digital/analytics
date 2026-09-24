import type { FieldSpec } from "@/lib/form-state";
import { EVENT_LISTS, EVENT_LIST_VERSION } from "@/lib/event-list";
import {
  CHANGE_KIND_LABELS,
  FRAMEWORK_LABELS,
  OWNERSHIP_LABELS,
  REGION_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  optionsFrom,
} from "@/lib/registry-labels";
import type { ClientDetail, SiteDetail } from "@/server/registry/clients";
import { SLUG_HINT } from "@/server/registry/schemas";

/** Field lists for each registry form, shared by the create and edit pages. */

export const ownershipField = (defaultValue?: string): FieldSpec => ({
  kind: "select",
  name: "analyticsOwnership",
  label: "Analytics ownership",
  hint: "Client-owned: the client runs PostHog themselves, like Agency Tap.",
  options: optionsFrom(OWNERSHIP_LABELS),
  defaultValue: defaultValue ?? "open_waters",
});

export const regulatedField = (defaultChecked = false): FieldSpec => ({
  kind: "checkbox",
  name: "regulated",
  label: "Regulated",
  hint: "Healthcare, finance and similar. Reports treat the data more cautiously.",
  defaultChecked,
});

export const newClientFields: FieldSpec[] = [
  { kind: "text", name: "name", label: "Name", placeholder: "Radara Health", required: true },
  {
    kind: "text",
    name: "slug",
    label: "Slug",
    hint: SLUG_HINT,
    placeholder: "radara",
    required: true,
  },
  ownershipField(),
  regulatedField(),
];

export function editClientFields(client: ClientDetail): FieldSpec[] {
  return [
    { kind: "text", name: "name", label: "Name", defaultValue: client.name, required: true },
    {
      kind: "select",
      name: "status",
      label: "Status",
      options: optionsFrom(STATUS_LABELS),
      defaultValue: client.status,
    },
    ownershipField(client.analyticsOwnership),
    regulatedField(client.regulated),
  ];
}

export function siteFields(site?: SiteDetail): FieldSpec[] {
  return [
    {
      kind: "url",
      name: "productionUrl",
      label: "Production URL",
      hint: "The root https URL, like https://radarahealth.com",
      defaultValue: site?.productionUrl,
      required: true,
    },
    {
      kind: "select",
      name: "framework",
      label: "Framework",
      options: optionsFrom(FRAMEWORK_LABELS),
      defaultValue: site?.framework ?? "astro",
    },
    {
      kind: "text",
      name: "repository",
      label: "Repository",
      hint: "Optional, like openwaters-digital/radara",
      defaultValue: site?.repository ?? "",
    },
    {
      kind: "date",
      name: "launchedOn",
      label: "Launched on",
      hint: "Leave empty until launch. Reports treat this as day one.",
      defaultValue: site?.launchedOn ?? "",
    },
    {
      kind: "select",
      name: "taxonomyVersion",
      label: "Event list version",
      options: Object.keys(EVENT_LISTS).map(version => ({
        value: version,
        label: `Version ${version}`,
      })),
      defaultValue: String(site?.taxonomyVersion ?? EVENT_LIST_VERSION),
    },
    {
      kind: "checkbox",
      name: "hasConsentBanner",
      label: "Has a consent banner",
      hint: "Only for sites running ads or replay behind a banner. Adds consent_updated to the expected events.",
      defaultChecked: site?.hasConsentBanner ?? false,
    },
    {
      kind: "text",
      name: "timezone",
      label: "Timezone",
      hint: "IANA name, like Europe/London",
      defaultValue: site?.timezone ?? "Europe/London",
    },
  ];
}

export function posthogFields(site: SiteDetail): FieldSpec[] {
  const connected = site.posthog !== null;
  return [
    {
      kind: "select",
      name: "region",
      label: "Region",
      options: optionsFrom(REGION_LABELS),
      defaultValue: site.posthog?.region ?? "eu",
    },
    {
      kind: "number",
      name: "projectId",
      label: "Project ID",
      hint: "From the project's settings in PostHog",
      defaultValue: site.posthog ? String(site.posthog.projectId) : "",
    },
    {
      kind: "password",
      name: "apiKey",
      label: connected ? "New API key" : "API key",
      hint: connected
        ? "Leave empty to keep the stored key. It is checked with PostHog before saving."
        : "A personal API key with Query Read access to this project only. Checked with PostHog before saving.",
    },
  ];
}

export function searchConsoleFields(site: SiteDetail): FieldSpec[] {
  return [
    {
      kind: "text",
      name: "property",
      label: "Search Console property",
      hint: "sc-domain:example.com or https://example.com/",
      defaultValue: site.searchConsoleProperty ?? "",
    },
  ];
}

export function commercialFields(site: SiteDetail): FieldSpec[] {
  const context = site.commercial;
  return [
    {
      kind: "text",
      name: "leadValue",
      label: "Average lead value",
      hint: "In whole currency units, like 2500",
      defaultValue:
        context?.leadValueMinor != null
          ? (context.leadValueMinor / 100).toFixed(2).replace(/\.00$/, "")
          : "",
    },
    {
      kind: "select",
      name: "currency",
      label: "Currency",
      placeholder: "Choose…",
      options: [
        { value: "GBP", label: "GBP (£)" },
        { value: "EUR", label: "EUR (€)" },
        { value: "USD", label: "USD ($)" },
      ],
      defaultValue: context?.currency ?? "GBP",
    },
    {
      kind: "text",
      name: "leadToCustomerRate",
      label: "Lead-to-customer rate",
      hint: "Between 0 and 1, like 0.2 for 20%",
      defaultValue: context?.leadToCustomerRate ? String(Number(context.leadToCustomerRate)) : "",
    },
    {
      kind: "select",
      name: "source",
      label: "Source of these figures",
      placeholder: "Choose…",
      options: optionsFrom(SOURCE_LABELS),
      defaultValue: context?.source ?? "",
    },
  ];
}

export function siteChangeFields(change?: SiteDetail["changes"][number]): FieldSpec[] {
  return [
    {
      kind: "date",
      name: "occurredOn",
      label: "Date",
      defaultValue: change?.occurredOn ?? new Date().toISOString().slice(0, 10),
    },
    {
      kind: "select",
      name: "kind",
      label: "Kind",
      options: optionsFrom(CHANGE_KIND_LABELS),
      defaultValue: change?.kind ?? "content",
    },
    {
      kind: "text",
      name: "title",
      label: "Title",
      hint: "Up to 120 characters",
      defaultValue: change?.title ?? "",
    },
    { kind: "textarea", name: "detail", label: "Detail", defaultValue: change?.detail ?? "" },
    {
      kind: "text",
      name: "expectedEffect",
      label: "Expected effect",
      hint: "What should change if this works",
      defaultValue: change?.expectedEffect ?? "",
    },
  ];
}

export const recipientFields: FieldSpec[] = [
  { kind: "text", name: "name", label: "Name", autoComplete: "off" },
  { kind: "email", name: "email", label: "Work email", autoComplete: "off" },
];
