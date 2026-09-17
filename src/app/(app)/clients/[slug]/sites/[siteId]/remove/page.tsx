import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { buttonClasses } from "@/components/ui/variants";
import { getSiteWithClient } from "@/server/registry/clients";
import { removeSiteAction } from "../../../../actions";

export const metadata: Metadata = { title: "Remove site" };

export default async function RemoveSitePage({
  params,
}: PageProps<"/clients/[slug]/sites/[siteId]/remove">) {
  const { slug, siteId } = await params;
  const found = await getSiteWithClient(slug, siteId);
  if (!found) notFound();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-(--gutter) py-8">
      <h1 className="text-display">Remove {found.site.productionUrl}?</h1>
      <Panel>
        <div className="flex flex-col gap-4">
          <p>
            This removes the site from {found.client.name}, with its PostHog connection and stored
            key, Search Console property, expected events, commercial context and learning log. It
            cannot be undone.
          </p>
          <form action={removeSiteAction.bind(null, slug, siteId)} className="flex flex-wrap gap-3">
            <input type="hidden" name="confirm" value="yes" />
            <Button type="submit" variant="danger">
              Remove site
            </Button>
            <Link
              href={`/clients/${slug}#site-${siteId}`}
              className={buttonClasses({ variant: "secondary" })}
            >
              Cancel
            </Link>
          </form>
        </div>
      </Panel>
    </main>
  );
}
