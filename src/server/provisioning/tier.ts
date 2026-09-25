import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { sites } from "@/db/schema";
import { measurementTiers } from "@/server/registry/schemas";
import { fromZodError, formError, ok, type Result } from "@/server/registry/result";
import { requireSession } from "@/server/session";

/**
 * The guard on the higher tiers (add-provisioning, design D5a). A partner
 * confirms, for the site's current tier, the two things the app cannot check:
 * that the consent banner is live on the production site, and that the privacy
 * page names the tools the tier adds. Until then, apply leaves recording off.
 */

export const TIER_MESSAGES = {
  essentials: "Essentials needs no confirmation.",
  changed: "The site's tier changed since this page loaded. Reload and confirm again.",
  missing: "That site no longer exists.",
} as const;

const mustTick = (message: string) =>
  z.union([z.literal("on"), z.literal("true")], { error: message }).transform(() => true as const);

const confirmSchema = z.object({
  // The tier the partner saw, so a confirmation cannot land on a tier changed
  // in the meantime.
  tier: z.enum(measurementTiers, { error: TIER_MESSAGES.changed }),
  bannerLive: mustTick("Confirm the consent banner is live on the production site."),
  privacyPageNamesTools: mustTick("Confirm the privacy page names the tools this tier adds."),
});

export async function confirmTier(siteId: string, input: unknown): Promise<Result> {
  const session = await requireSession();
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  if (parsed.data.tier === "essentials") return formError(TIER_MESSAGES.essentials);

  const [site] = await getDb()
    .select({ measurementTier: sites.measurementTier })
    .from(sites)
    .where(eq(sites.id, siteId));
  if (!site) return formError(TIER_MESSAGES.missing);
  if (site.measurementTier !== parsed.data.tier) return formError(TIER_MESSAGES.changed);

  await getDb()
    .update(sites)
    .set({
      tierConfirmedFor: parsed.data.tier,
      tierConfirmedAt: new Date(),
      tierConfirmedBy: session.user.id,
    })
    .where(eq(sites.id, siteId));
  console.info(`provisioning: tier ${parsed.data.tier} confirmed for site ${siteId}`);
  return ok();
}
