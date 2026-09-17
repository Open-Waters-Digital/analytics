import type { Metadata } from "next";
import Link from "next/link";
import { RegistryForm } from "@/components/registry/registry-form";
import { Panel } from "@/components/ui/panel";
import { createClientAction } from "../actions";
import { newClientFields } from "../fields";

export const metadata: Metadata = { title: "Add client" };

export default function NewClientPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-(--gutter) py-8">
      <Link
        href="/clients"
        className="text-caption text-ink-muted underline-offset-4 hover:underline"
      >
        ← Clients
      </Link>
      <h1 className="text-display">Add client</h1>
      <Panel>
        <RegistryForm
          action={createClientAction}
          fields={newClientFields}
          submitLabel="Add client"
        />
      </Panel>
    </main>
  );
}
