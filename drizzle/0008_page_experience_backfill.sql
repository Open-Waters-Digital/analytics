-- add-page-experience, design D7. Every site tracks its home page; the site
-- form adds it for new sites, and this gives it to every site that exists.
INSERT INTO "site_tracked_pages" ("site_id", "path")
SELECT "id", '/' FROM "sites"
ON CONFLICT ("site_id", "path") DO NOTHING;
