import type { Metadata } from "next";
import Link from "next/link";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { buttonClasses } from "@/components/ui/variants";
import {
  formatDateTime,
  formatRelative,
  OWNERSHIP_LABELS,
  STATUS_LABELS,
  STATUS_TONES,
} from "@/lib/registry-labels";
import { listClients } from "@/server/registry/clients";
import { getLastSnapshotRun, isStale, type SnapshotRun } from "@/server/snapshots/read";

export const metadata: Metadata = { title: "Clients" };

/**
 * The nightly job has no other voice: if it stops running, nothing else on this
 * screen changes. This line is how that becomes visible.
 */
function SnapshotLine({ run }: { run: SnapshotRun | null }) {
  const stale = isStale(run, new Date());
  const finished = run?.finishedAt;

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption">
      <StatusDot
        tone={stale ? "warning" : "success"}
        label={
          finished
            ? `Snapshot last ran ${formatRelative(finished)}`
            : run
              ? "Snapshot started but never finished"
              : "Snapshot has never run"
        }
      />
      {finished ? <span className="text-ink-muted">{formatDateTime(finished)}</span> : null}
      {run && finished ? (
        <span className="text-ink-muted tabular-nums">
          · {run.sitesOk} pulled, {run.sitesFailed} failed, {run.sitesSkipped} skipped
        </span>
      ) : null}
    </p>
  );
}

export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  const includeOffboarded = (await searchParams).offboarded === "1";
  const [clients, lastRun] = await Promise.all([
    listClients({ includeOffboarded }),
    getLastSnapshotRun(),
  ]);

  return (
    <main className="mx-auto flex max-w-(--container-max) flex-col gap-6 px-(--gutter) py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display">Clients</h1>
          <p className="mt-1 text-ink-muted">
            Every client, their sites and whether their data can be read.
          </p>
        </div>
        <Link href="/clients/new" className={buttonClasses()}>
          Add client
        </Link>
      </header>

      <SnapshotLine run={lastRun} />

      <Panel>
        {clients.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p>{includeOffboarded ? "No clients yet." : "No current clients."}</p>
            <Link href="/clients/new" className="font-medium underline underline-offset-4">
              Add the first client
            </Link>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Client</Th>
                <Th>Status</Th>
                <Th>Analytics</Th>
                <Th>Sites</Th>
                <Th>PostHog</Th>
              </tr>
            </thead>
            <tbody>
              {clients.map(client => (
                <Tr key={client.id}>
                  <Td>
                    <Link
                      href={`/clients/${client.slug}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {client.name}
                    </Link>
                    <span className="block text-caption whitespace-nowrap text-ink-muted">
                      {client.slug}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONES[client.status]}>{STATUS_LABELS[client.status]}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {OWNERSHIP_LABELS[client.analyticsOwnership]}
                  </Td>
                  <Td className="tabular-nums">{client.siteCount}</Td>
                  <Td className="whitespace-nowrap tabular-nums">
                    {client.siteCount === 0 ? (
                      <span className="text-ink-muted">No sites</span>
                    ) : (
                      <StatusDot
                        tone={
                          client.connectedSiteCount === client.siteCount
                            ? "success"
                            : client.analyticsOwnership === "client_owned"
                              ? "neutral"
                              : "warning"
                        }
                        label={`${client.connectedSiteCount} of ${client.siteCount} connected`}
                      />
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <p className="text-caption">
        {includeOffboarded ? (
          <Link href="/clients" className="underline underline-offset-4">
            Hide offboarded clients
          </Link>
        ) : (
          <Link href="/clients?offboarded=1" className="underline underline-offset-4">
            Show offboarded clients
          </Link>
        )}
      </p>
    </main>
  );
}
