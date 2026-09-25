import { z } from "zod";
import { eventsFor, isKnownVersion } from "@/lib/event-list";

/**
 * Validation for every registry input, written against what a form posts
 * (strings, and absent keys for unticked checkboxes). The server always parses
 * with these, whatever the browser checked.
 */

const trimmed = (max: number, label: string) =>
  z
    .string({ error: `Enter ${label}.` })
    .trim()
    .min(1, `Enter ${label}.`)
    .max(max, `Keep ${label} to ${max} characters or fewer.`);

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `Keep ${label} to ${max} characters or fewer.`)
    .optional()
    .transform(value => (value ? value : null));

// An unticked checkbox is absent from form data, so the key must be optional.
const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal(""), z.null()])
  .optional()
  .transform(value => value === "on" || value === "true");

const confirmYes = z.literal("yes", { error: "Confirm before removing." });

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date as YYYY-MM-DD.")
  .refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "Enter a real date.");

// ---- Clients -----------------------------------------------------------------

export const SLUG_PATTERN = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9]))*$/;
export const SLUG_HINT =
  "2–40 lowercase letters, numbers and single hyphens, starting with a letter. Matches SITE_SLUG in the site's code.";

export const clientStatuses = ["onboarding", "active", "paused", "offboarded"] as const;
export const ownerships = ["open_waters", "client_owned"] as const;

export const createClientSchema = z.object({
  name: trimmed(120, "a name"),
  slug: z
    .string({ error: "Enter a slug." })
    .trim()
    .min(2, SLUG_HINT)
    .max(40, SLUG_HINT)
    .regex(SLUG_PATTERN, SLUG_HINT),
  analyticsOwnership: z.enum(ownerships, { error: "Choose who owns the analytics." }),
  regulated: checkbox,
});

/** No slug: it is fixed at creation. Any slug in the input is ignored. */
export const updateClientSchema = z.object({
  name: trimmed(120, "a name"),
  status: z.enum(clientStatuses, { error: "Choose a status." }),
  analyticsOwnership: z.enum(ownerships, { error: "Choose who owns the analytics." }),
  regulated: checkbox,
});

// ---- Sites -------------------------------------------------------------------

export const frameworks = ["astro", "next", "other"] as const;

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    // Intl accepts some bare abbreviations; require the Area/Location form.
    return value === "UTC" || value.includes("/");
  } catch {
    return false;
  }
}

export const productionUrl = z
  .string({ error: "Enter the production URL." })
  .trim()
  .min(1, "Enter the production URL.")
  .transform((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a full URL, like https://example.com." });
      return z.NEVER;
    }
    if (url.protocol !== "https:") {
      ctx.addIssue({ code: "custom", message: "The production URL must use https." });
      return z.NEVER;
    }
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
      ctx.addIssue({
        code: "custom",
        message: "Use the site's root URL only, with no path, like https://example.com.",
      });
      return z.NEVER;
    }
    return url.origin;
  });

export const measurementTiers = ["essentials", "insights", "growth"] as const;

export const siteSchema = z
  .object({
    productionUrl,
    framework: z.enum(frameworks, { error: "Choose a framework." }),
    repository: optionalText(200, "the repository"),
    launchedOn: z
      .union([z.literal(""), isoDate])
      .optional()
      .transform(value => (value ? value : null)),
    taxonomyVersion: z.coerce
      .number({ error: "Choose an event list version." })
      .int()
      .refine(isKnownVersion, "Choose an event list version that exists."),
    timezone: z
      .string()
      .trim()
      .default("Europe/London")
      .transform(value => value || "Europe/London")
      .refine(isValidTimezone, "Use an IANA timezone name, such as Europe/London."),
    measurementTier: z
      .enum(measurementTiers, { error: "Choose a measurement tier." })
      .default("essentials"),
    usesHeatmaps: checkbox,
  })
  // The consent banner follows the tier (add-provisioning, design D5a): Insights
  // and Growth mean a banner, Essentials none. It is never set on its own.
  .transform(site => ({ ...site, hasConsentBanner: site.measurementTier !== "essentials" }));

export const removeSchema = z.object({ confirm: confirmYes });

// ---- Report recipients -------------------------------------------------------

export const recipientSchema = z.object({
  name: trimmed(120, "a name"),
  email: z
    .string({ error: "Enter an email address." })
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter an email address, like name@example.com.")),
});

// ---- PostHog connection ------------------------------------------------------

export const regions = ["eu", "us"] as const;

export const posthogConnectionSchema = z.object({
  region: z.enum(regions, { error: "Choose a region." }),
  projectId: z.coerce
    .number({ error: "Enter the project ID, a whole number." })
    .int("Enter the project ID, a whole number.")
    .positive("Enter the project ID, a whole number."),
  // Optional only when replacing: a blank key keeps the stored one.
  apiKey: z
    .string()
    .trim()
    .max(200, "That does not look like a PostHog API key.")
    .optional()
    .transform(value => (value ? value : null)),
});

// ---- Search Console ----------------------------------------------------------

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const PROPERTY_HINT =
  "Use a domain property (sc-domain:example.com) or a URL-prefix property (https://example.com/).";

export const searchConsoleSchema = z.object({
  property: z
    .string({ error: PROPERTY_HINT })
    .trim()
    .min(1, PROPERTY_HINT)
    .refine(value => {
      if (value.startsWith("sc-domain:")) return HOSTNAME.test(value.slice("sc-domain:".length));
      try {
        const url = new URL(value);
        return url.protocol === "https:" && value.endsWith("/") && !url.search && !url.hash;
      } catch {
        return false;
      }
    }, PROPERTY_HINT),
});

// ---- Expected events ---------------------------------------------------------

export function expectedEventsSchema(version: number) {
  const names = new Set((eventsFor(version) ?? []).map(event => event.name));
  return z.object({
    events: z
      .array(z.string())
      .refine(
        events => events.every(event => names.has(event)),
        "Only events from the site's event list can be expected.",
      )
      .transform(events => [...new Set(events)]),
  });
}

// ---- Commercial context ------------------------------------------------------

export const currencies = ["GBP", "EUR", "USD"] as const;
export const figureSources = ["client_confirmed", "open_waters_estimate"] as const;

const MONEY = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;
const MAX_MINOR = 1_000_000_000; // £10,000,000.00, well inside Postgres integer

/** "2,500" or "2500.50" in major units → integer minor units. */
export function toMinorUnits(value: string): number | null {
  const cleaned = value.trim();
  if (!MONEY.test(cleaned)) return null;
  const [whole = "0", fraction = ""] = cleaned.replaceAll(",", "").split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export const commercialContextSchema = z
  .object({
    leadValue: z
      .string()
      .trim()
      .optional()
      .transform((value, ctx) => {
        if (!value) return null;
        const minor = toMinorUnits(value);
        if (minor === null || minor > MAX_MINOR) {
          ctx.addIssue({
            code: "custom",
            message: "Enter an amount, like 2500 or 2,500.00. It cannot be negative.",
          });
          return z.NEVER;
        }
        return minor;
      }),
    currency: z
      .union([z.enum(currencies), z.literal("")])
      .optional()
      .transform(value => (value ? value : null)),
    leadToCustomerRate: z
      .string()
      .trim()
      .optional()
      .transform((value, ctx) => {
        if (!value) return null;
        if (!/^\d+(?:\.\d{1,4})?$/.test(value) || Number(value) > 1) {
          ctx.addIssue({
            code: "custom",
            message: "Enter a rate between 0 and 1, such as 0.2 for 20%.",
          });
          return z.NEVER;
        }
        return Number(value).toFixed(4);
      }),
    source: z
      .union([z.enum(figureSources), z.literal("")])
      .optional()
      .transform(value => (value ? value : null)),
  })
  .superRefine((value, ctx) => {
    const hasFigure = value.leadValue !== null || value.leadToCustomerRate !== null;
    if (hasFigure && !value.source) {
      ctx.addIssue({
        code: "custom",
        path: ["source"],
        message: "Say whether the client confirmed these figures or they are an estimate.",
      });
    }
    if (value.leadValue !== null && !value.currency) {
      ctx.addIssue({ code: "custom", path: ["currency"], message: "Choose a currency." });
    }
  });

// ---- Learning log ------------------------------------------------------------

export const siteChangeKinds = [
  "launch",
  "design",
  "content",
  "campaign",
  "experiment",
  "tracking",
] as const;

export const siteChangeSchema = z.object({
  occurredOn: isoDate,
  kind: z.enum(siteChangeKinds, { error: "Choose what kind of change this was." }),
  title: trimmed(120, "a title"),
  detail: optionalText(2000, "the detail"),
  expectedEffect: optionalText(500, "the expected effect"),
});
