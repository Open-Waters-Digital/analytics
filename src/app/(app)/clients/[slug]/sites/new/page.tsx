import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RegistryForm } from "@/components/registry/registry-form";
import { Panel } from "@/components/ui/panel";
import { getClientDetail } from "@/server/registry/clients";
import { createSiteAction } from "../../../actions";
import { siteFields } from "../../../fields";

export const metadata: Metadata = { title: "Add site" };

export default async function NewSitePage({ params }: PageProps<"/clients/[slug]/sites/new">) {
  const { slug } = await params;
  const client = await getClientDetail(slug);
  if (!client) notFound();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-(--gutter) py-8">
      <Link
        href={`/clients/${slug}`}
        className="text-caption text-ink-muted underline-offset-4 hover:underline"
      >
        ← {client.name}
      </Link>
      <h1 className="text-display">Add site</h1>
      <p className="text-ink-muted">
        Every event on the chosen event list is expected by default. Untick the ones this site does
        not send afterwards.
      </p>
      <Panel>
        <RegistryForm
          action={createSiteAction.bind(null, slug)}
          fields={siteFields()}
          submitLabel="Add site"
        />
      </Panel>
    </main>
  );
}
