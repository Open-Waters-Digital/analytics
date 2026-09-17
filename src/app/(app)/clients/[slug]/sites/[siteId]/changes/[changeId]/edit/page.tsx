import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RegistryForm } from "@/components/registry/registry-form";
import { Panel } from "@/components/ui/panel";
import { getSiteWithClient } from "@/server/registry/clients";
import { updateSiteChangeAction } from "../../../../../../actions";
import { siteChangeFields } from "../../../../../../fields";

export const metadata: Metadata = { title: "Edit log entry" };

export default async function EditChangePage({
  params,
}: PageProps<"/clients/[slug]/sites/[siteId]/changes/[changeId]/edit">) {
  const { slug, siteId, changeId } = await params;
  const found = await getSiteWithClient(slug, siteId);
  const change = found?.site.changes.find(candidate => candidate.id === changeId);
  if (!found || !change) notFound();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-(--gutter) py-8">
      <Link
        href={`/clients/${slug}#site-${siteId}`}
        className="text-caption text-ink-muted underline-offset-4 hover:underline"
      >
        ← {found.client.name}
      </Link>
      <h1 className="text-display">Edit log entry</h1>
      <Panel>
        <RegistryForm
          action={updateSiteChangeAction.bind(null, slug, siteId, changeId)}
          fields={siteChangeFields(change)}
          submitLabel="Save"
        />
      </Panel>
    </main>
  );
}
