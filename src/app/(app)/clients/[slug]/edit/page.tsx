import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RegistryForm } from "@/components/registry/registry-form";
import { Panel } from "@/components/ui/panel";
import { getClientDetail } from "@/server/registry/clients";
import { updateClientAction } from "../../actions";
import { editClientFields } from "../../fields";

export const metadata: Metadata = { title: "Edit client" };

export default async function EditClientPage({ params }: PageProps<"/clients/[slug]/edit">) {
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
      <h1 className="text-display">Edit client</h1>
      <p className="text-ink-muted">
        The slug <code>{client.slug}</code> is fixed: it must match SITE_SLUG in the site&apos;s
        code.
      </p>
      <Panel>
        <RegistryForm
          action={updateClientAction.bind(null, slug)}
          fields={editClientFields(client)}
          submitLabel="Save"
        />
      </Panel>
    </main>
  );
}
