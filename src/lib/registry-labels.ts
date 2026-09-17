/**
 * Display text for registry values, shared by every screen. Tones pair with a
 * text label everywhere: colour never carries meaning alone.
 */
import type { Tone } from "@/components/ui/variants";

export const STATUS_LABELS = {
  onboarding: "Onboarding",
  active: "Active",
  paused: "Paused",
  offboarded: "Offboarded",
} as const;

export const STATUS_TONES: Record<keyof typeof STATUS_LABELS, Tone> = {
  onboarding: "info",
  active: "success",
  paused: "warning",
  offboarded: "neutral",
};

export const OWNERSHIP_LABELS = {
  open_waters: "Open Waters",
  client_owned: "Client-owned",
} as const;

export const FRAMEWORK_LABELS = { astro: "Astro", next: "Next.js", other: "Other" } as const;

export const REGION_LABELS = { eu: "EU", us: "US" } as const;

export const SOURCE_LABELS = {
  client_confirmed: "Client confirmed",
  open_waters_estimate: "Open Waters estimate",
} as const;

export const CHANGE_KIND_LABELS = {
  launch: "Launch",
  design: "Design",
  content: "Content",
  campaign: "Campaign",
  experiment: "Experiment",
  tracking: "Tracking",
} as const;

export const STAGE_LABELS = { intent: "Intent", action: "Action", revenue: "Revenue" } as const;

export function optionsFrom<T extends Record<string, string>>(labels: T) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

export type ConnectionStatus = "ok" | "unauthorised" | "project_not_found" | "error";

export function connectionDisplay(
  connection: { lastCheckStatus: ConnectionStatus | null } | null,
  clientOwned: boolean,
): { tone: Tone; label: string } {
  if (!connection) {
    return clientOwned
      ? { tone: "neutral", label: "Client-owned analytics" }
      : { tone: "warning", label: "Not connected" };
  }
  switch (connection.lastCheckStatus) {
    case "ok":
      return { tone: "success", label: "Connected" };
    case "unauthorised":
      return { tone: "danger", label: "Key rejected" };
    case "project_not_found":
      return { tone: "danger", label: "Project not found" };
    case "error":
      return { tone: "danger", label: "Check failed" };
    default:
      return { tone: "neutral", label: "Not checked" };
  }
}

export function formatMoney(minor: number, currency: "GBP" | "EUR" | "USD"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

export function formatPercent(rate: string): string {
  return new Intl.NumberFormat("en-GB", { style: "percent", maximumFractionDigits: 2 }).format(
    Number(rate),
  );
}

export function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(date);
}
