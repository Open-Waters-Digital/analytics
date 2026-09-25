-- add-provisioning, design D5a. A site already marked as having a consent
-- banner was set up for more than Essentials, so it starts at Insights; a
-- partner corrects it to Growth where that is right. Unconfirmed, so nothing
-- tier-dependent is applied until a partner confirms.
UPDATE "sites" SET "measurement_tier" = 'insights' WHERE "has_consent_banner" = true;
--> statement-breakpoint
-- The Open Waters website turns aggregate heatmaps on deliberately.
UPDATE "sites" SET "uses_heatmaps" = true
FROM "clients"
WHERE "clients"."id" = "sites"."client_id" AND "clients"."slug" = 'open-waters';
