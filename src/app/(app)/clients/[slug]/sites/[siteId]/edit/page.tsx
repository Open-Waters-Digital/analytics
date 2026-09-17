import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RegistryForm } from "@/components/registry/registry-form";
import { Panel } from "@/components/ui/panel";
import { getSiteWithClient } from "@/server/registry/clients";
import { updateSiteAction } from "../../../../actions";
import { siteFields } from "../../../../fields";

export const metadata: Metadata = { title: "Edit site" };

export default async function EditSitePage({
  params,
}: PageProps<"/clients/[slug]/sites/[siteId]/edit">) {
  const { slug, siteId } = await params;
  const found = await getSiteWithClient(slug, siteId);
  if (!found) notFound();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-(--gutter) py-8">
      <Link
        href={`/clients/${slug}#site-${siteId}`}
        className="text-caption text-ink-muted underline-offset-4 hover:underline"
      >
        ← {found.client.name}
      </Link>
      <h1 className="text-display">Edit site</h1>
      <p className="text-ink-muted">
        Changing the event list version does not change which events are expected. Update those on
        the client page.
      </p>
      <Panel>
        <RegistryForm
          action={updateSiteAction.bind(null, slug, siteId)}
          fields={siteFields(found.site)}
          submitLabel="Save"
        />
      </Panel>
    </main>
  );
}
