import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { buttonClasses } from "@/components/ui/variants";
import { getSiteWithClient } from "@/server/registry/clients";
import { removePostHogAction } from "../../../../../actions";

export const metadata: Metadata = { title: "Remove PostHog connection" };

export default async function RemovePostHogPage({
  params,
}: PageProps<"/clients/[slug]/sites/[siteId]/posthog/remove">) {
  const { slug, siteId } = await params;
  const found = await getSiteWithClient(slug, siteId);
  if (!found || !found.site.posthog) notFound();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-(--gutter) py-8">
      <h1 className="text-display">Remove the PostHog connection?</h1>
      <Panel>
        <div className="flex flex-col gap-4">
          <p>
            The stored key ending {found.site.posthog.keyLast4} for {found.site.productionUrl} will
            be deleted. Nothing is changed in PostHog; revoke the key there too if it is no longer
            needed.
          </p>
          <form
            action={removePostHogAction.bind(null, slug, siteId)}
            className="flex flex-wrap gap-3"
          >
            <input type="hidden" name="confirm" value="yes" />
            <Button type="submit" variant="danger">
              Remove connection
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
