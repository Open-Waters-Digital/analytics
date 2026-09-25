import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ProvisioningPanel } from "@/components/registry/provisioning-panel";
import { RegistryForm } from "@/components/registry/registry-form";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DescriptionList } from "@/components/ui/description-list";
import { Panel } from "@/components/ui/panel";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { buttonClasses } from "@/components/ui/variants";
import { eventsFor } from "@/lib/event-list";
import {
  CHANGE_KIND_LABELS,
  connectionDisplay,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatRelative,
  FRAMEWORK_LABELS,
  OWNERSHIP_LABELS,
  REGION_LABELS,
  SNAPSHOT_OUTCOME_LABELS,
  SNAPSHOT_OUTCOME_TONES,
  SOURCE_LABELS,
  STAGE_LABELS,
  STATUS_LABELS,
  STATUS_TONES,
  TIER_LABELS,
} from "@/lib/registry-labels";
import { latestProvisioningRuns, type LatestRun } from "@/server/provisioning";
import { REQUIRED_SCOPES } from "@/server/provisioning/posthog-fields";
import { getClientDetail, type ClientDetail, type SiteDetail } from "@/server/registry/clients";
import {
  getSiteSnapshots,
  RECENT_DAYS,
  type BreakdownMetric,
  type SiteSnapshot,
} from "@/server/snapshots/read";
import {
  addRecipientAction,
  addSiteChangeAction,
  deleteSiteChangeAction,
  removeRecipientAction,
  saveCommercialAction,
  savePostHogAction,
  saveSearchConsoleAction,
  setExpectedEventsAction,
  testPostHogAction,
} from "../actions";
import {
  commercialFields,
  posthogFields,
  recipientFields,
  searchConsoleFields,
  siteChangeFields,
} from "../fields";
import { confirmTierAction, provisioningAction } from "../provisioning-actions";

export async function generateMetadata({
  params,
}: PageProps<"/clients/[slug]">): Promise<Metadata> {
  const client = await getClientDetail((await params).slug);
  return { title: client?.name ?? "Client" };
}

export default async function ClientPage({ params }: PageProps<"/clients/[slug]">) {
  const { slug } = await params;
  const client = await getClientDetail(slug);
  if (!client) notFound();

  const siteIds = client.sites.map(site => site.id);
  const [snapshots, runs] = await Promise.all([
    getSiteSnapshots(siteIds),
    latestProvisioningRuns(siteIds),
  ]);

  return (
    <main className="mx-auto flex max-w-(--container-max) flex-col gap-6 px-(--gutter) py-8">
      <Link
        href="/clients"
        className="text-caption text-ink-muted underline-offset-4 hover:underline"
      >
        ← Clients
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-display">{client.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
            <Badge tone={STATUS_TONES[client.status]}>{STATUS_LABELS[client.status]}</Badge>
            <span>
              <code>{client.slug}</code>
            </span>
            <span>· {OWNERSHIP_LABELS[client.analyticsOwnership]} analytics</span>
            {client.regulated ? <span>· Regulated</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href={`/clients/${slug}/edit`} className={buttonClasses({ variant: "secondary" })}>
            Edit client
          </Link>
          <Link href={`/clients/${slug}/sites/new`} className={buttonClasses()}>
            Add site
          </Link>
        </div>
      </header>

      {client.sites.length === 0 ? (
        <Panel>
          <p>
            No sites yet.{" "}
            <Link
              href={`/clients/${slug}/sites/new`}
              className="font-medium underline underline-offset-4"
            >
              Add the first site
            </Link>
            .
          </p>
        </Panel>
      ) : (
        client.sites.map(site => (
          <SitePanel
            key={site.id}
            client={client}
            site={site}
            snapshot={snapshots.get(site.id) ?? null}
            lastRun={runs.get(site.id) ?? null}
          />
        ))
      )}

      <RecipientsPanel client={client} />
    </main>
  );
}

function SitePanel({
  client,
  site,
  snapshot,
  lastRun,
}: {
  client: ClientDetail;
  site: SiteDetail;
  snapshot: SiteSnapshot | null;
  lastRun: LatestRun | null;
}) {
  const slug = client.slug;
  const clientOwned = client.analyticsOwnership === "client_owned";
  const connection = connectionDisplay(site.posthog, clientOwned);
  const listed = eventsFor(site.taxonomyVersion) ?? [];

  return (
    <section id={`site-${site.id}`} className="scroll-mt-6">
      <Panel
        title={site.productionUrl}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/clients/${slug}/sites/${site.id}/edit`}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              Edit
            </Link>
            <Link
              href={`/clients/${slug}/sites/${site.id}/remove`}
              className={buttonClasses({ variant: "ghost", size: "sm" })}
            >
              Remove
            </Link>
          </div>
        }
      >
        <div className="flex flex-col gap-8">
          <DescriptionList
            items={[
              { term: "Framework", value: FRAMEWORK_LABELS[site.framework] },
              { term: "Repository", value: site.repository ?? <Muted>Not recorded</Muted> },
              {
                term: "Launched",
                value: site.launchedOn ? formatDate(site.launchedOn) : <Muted>Not launched</Muted>,
              },
              { term: "Event list", value: `Version ${site.taxonomyVersion}` },
              {
                term: "Measurement tier",
                value: `${TIER_LABELS[site.measurementTier]}${site.usesHeatmaps ? " · heatmaps" : ""}`,
              },
              { term: "Timezone", value: site.timezone },
              {
                term: "PostHog",
                value: <StatusDot tone={connection.tone} label={connection.label} />,
              },
            ]}
          />

          <SubSection title="PostHog connection">
            {site.posthog ? (
              <div className="flex flex-col gap-3">
                <DescriptionList
                  items={[
                    { term: "Region", value: REGION_LABELS[site.posthog.region] },
                    { term: "Project ID", value: String(site.posthog.projectId) },
                    { term: "API key", value: <code>•••• {site.posthog.keyLast4}</code> },
                    {
                      term: "Last checked",
                      value: site.posthog.lastCheckAt ? (
                        formatDateTime(site.posthog.lastCheckAt)
                      ) : (
                        <Muted>Never</Muted>
                      ),
                    },
                  ]}
                />
                {site.posthog.lastCheckStatus && site.posthog.lastCheckStatus !== "ok" ? (
                  <Alert tone="danger">{site.posthog.lastCheckMessage ?? connection.label}</Alert>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <form action={testPostHogAction.bind(null, slug, site.id)}>
                    <Button type="submit" variant="secondary" size="sm">
                      Test connection
                    </Button>
                  </form>
                  <Link
                    href={`/clients/${slug}/sites/${site.id}/posthog/remove`}
                    className={buttonClasses({ variant: "ghost", size: "sm" })}
                  >
                    Remove connection
                  </Link>
                </div>
              </div>
            ) : clientOwned ? (
              <Alert tone="info">
                This client runs PostHog themselves. Add a connection only if they share a read-only
                key.
              </Alert>
            ) : null}
            <Disclosure
              summary={site.posthog ? "Change connection" : "Connect PostHog"}
              open={!site.posthog && !clientOwned}
            >
              <RegistryForm
                action={savePostHogAction.bind(null, slug, site.id)}
                fields={posthogFields(site)}
                submitLabel={site.posthog ? "Check and save" : "Check and connect"}
                columns={2}
              />
            </Disclosure>
          </SubSection>

          <SubSection title="PostHog project">
            <ProjectSection site={site} lastRun={lastRun} clientOwned={clientOwned} />
          </SubSection>

          <SubSection title="Measurement">
            <SnapshotSummary snapshot={snapshot} connected={site.posthog !== null} />
          </SubSection>

          <SubSection title="Search Console">
            <p className="text-data">
              {site.searchConsoleProperty ? (
                <>
                  <code>{site.searchConsoleProperty}</code> <Muted>· Not checked</Muted>
                </>
              ) : (
                <Muted>No property recorded</Muted>
              )}
            </p>
            <Disclosure summary={site.searchConsoleProperty ? "Change property" : "Add property"}>
              <RegistryForm
                action={saveSearchConsoleAction.bind(null, slug, site.id)}
                fields={searchConsoleFields(site)}
                submitLabel="Save property"
              />
            </Disclosure>
          </SubSection>

          <SubSection title="Expected events">
            <p className="text-data">
              {site.expectedEvents.length} of {listed.length} events on version{" "}
              {site.taxonomyVersion} expected.
            </p>
            <Disclosure summary="Choose expected events">
              <RegistryForm
                action={setExpectedEventsAction.bind(null, slug, site.id)}
                fields={[
                  {
                    kind: "checkboxes",
                    name: "events",
                    legend: "Events this site should send",
                    options: listed.map(event => ({
                      value: event.name,
                      label: event.name,
                      hint: `${STAGE_LABELS[event.stage]}${event.server ? " · server" : ""}`,
                    })),
                    defaultValues: site.expectedEvents,
                  },
                ]}
                submitLabel="Save expected events"
              />
            </Disclosure>
          </SubSection>

          <SubSection title="Commercial context">
            <CommercialSummary site={site} />
            <Disclosure summary={site.commercial ? "Change figures" : "Add figures"}>
              <RegistryForm
                action={saveCommercialAction.bind(null, slug, site.id)}
                fields={commercialFields(site)}
                submitLabel="Save figures"
                columns={2}
              />
            </Disclosure>
          </SubSection>

          <SubSection title="Learning log">
            {site.changes.length === 0 ? (
              <p className="text-data">
                <Muted>Nothing logged yet. Start with the launch.</Muted>
              </p>
            ) : (
              <ol className="flex flex-col divide-y divide-hairline">
                {site.changes.map(change => (
                  <li key={change.id} className="flex flex-col gap-1 py-3 first:pt-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium">{change.title}</p>
                      <div className="flex gap-2">
                        <Link
                          href={`/clients/${slug}/sites/${site.id}/changes/${change.id}/edit`}
                          className={buttonClasses({ variant: "ghost", size: "sm" })}
                        >
                          Edit
                        </Link>
                        <form action={deleteSiteChangeAction.bind(null, slug, site.id, change.id)}>
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            aria-label={`Delete “${change.title}”`}
                          >
                            Delete
                          </Button>
                        </form>
                      </div>
                    </div>
                    <p className="text-caption text-ink-muted">
                      {formatDate(change.occurredOn)} · {CHANGE_KIND_LABELS[change.kind]}
                    </p>
                    {change.detail ? (
                      <p className="text-data whitespace-pre-line">{change.detail}</p>
                    ) : null}
                    {change.expectedEffect ? (
                      <p className="text-data">
                        <Muted>Expected effect:</Muted> {change.expectedEffect}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
            <Disclosure summary="Log a change">
              <RegistryForm
                action={addSiteChangeAction.bind(null, slug, site.id)}
                fields={siteChangeFields()}
                submitLabel="Add entry"
                columns={2}
              />
            </Disclosure>
          </SubSection>
        </div>
      </Panel>
    </section>
  );
}

function RecipientsPanel({ client }: { client: ClientDetail }) {
  return (
    <Panel title="Report recipients">
      <div className="flex flex-col gap-4">
        {client.recipients.length === 0 ? (
          <p className="text-data">
            <Muted>No recipients yet.</Muted>
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-hairline">
            {client.recipients.map(recipient => (
              <li
                key={recipient.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0"
              >
                <span className="text-data">
                  {recipient.name} <Muted>· {recipient.email}</Muted>
                </span>
                <form action={removeRecipientAction.bind(null, client.slug, recipient.id)}>
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${recipient.name}`}
                  >
                    Remove
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <Disclosure summary="Add recipient">
          <RegistryForm
            action={addRecipientAction.bind(null, client.slug)}
            fields={recipientFields}
            submitLabel="Add recipient"
            columns={2}
          />
        </Disclosure>
      </div>
    </Panel>
  );
}

function CommercialSummary({ site }: { site: SiteDetail }) {
  const context = site.commercial;
  if (!context || (context.leadValueMinor === null && context.leadToCustomerRate === null)) {
    return (
      <p className="text-data">
        <Muted>No figures yet.</Muted>
      </p>
    );
  }
  const source = context.source ? SOURCE_LABELS[context.source] : null;
  return (
    <DescriptionList
      items={[
        {
          term: "Average lead value",
          value:
            context.leadValueMinor !== null && context.currency ? (
              `${formatMoney(context.leadValueMinor, context.currency)}${source ? ` (${source})` : ""}`
            ) : (
              <Muted>Not recorded</Muted>
            ),
        },
        {
          term: "Lead-to-customer rate",
          value:
            context.leadToCustomerRate !== null ? (
              `${formatPercent(context.leadToCustomerRate)}${source ? ` (${source})` : ""}`
            ) : (
              <Muted>Not recorded</Muted>
            ),
        },
      ]}
    />
  );
}

/**
 * What the nightly snapshot last did for this site, and the week it holds. The
 * table is the same shape for every site, so two clients can be compared by
 * looking, and it scrolls inside its wrapper at 375px like every other table.
 */
function SnapshotSummary({
  snapshot,
  connected,
}: {
  snapshot: SiteSnapshot | null;
  connected: boolean;
}) {
  const last = snapshot?.lastResult ?? null;

  if (!last) {
    return (
      <p className="text-data">
        <Muted>
          {connected
            ? "Not pulled yet. The nightly snapshot will collect the first thirty days."
            : "Nothing to pull until PostHog is connected."}
        </Muted>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-data">
        <StatusDot
          tone={SNAPSHOT_OUTCOME_TONES[last.outcome]}
          label={SNAPSHOT_OUTCOME_LABELS[last.outcome]}
        />
        <Muted>
          {formatRelative(last.at)} · {formatDateTime(last.at)}
        </Muted>
      </p>

      {last.outcome !== "ok" && last.reason ? (
        <Alert tone={last.outcome === "failed" ? "danger" : "info"}>{last.reason}</Alert>
      ) : null}

      {snapshot && snapshot.days.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <Th>Day</Th>
              <Th className="text-right">Page views</Th>
              <Th className="text-right">Sessions</Th>
              <Th className="text-right">Leads</Th>
            </tr>
          </thead>
          <tbody>
            {snapshot.days.map(day => (
              <Tr key={day.day}>
                <Td className="whitespace-nowrap">{formatDate(day.day)}</Td>
                <Td className="text-right tabular-nums">{day.pageViews}</Td>
                <Td className="text-right tabular-nums">{day.sessions}</Td>
                <Td className="text-right tabular-nums">{day.leads}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="text-data">
          <Muted>No days stored yet.</Muted>
        </p>
      )}

      {snapshot?.breakdowns.map(breakdown => (
        <p key={breakdown.metric} className="flex flex-wrap gap-x-2 gap-y-1 text-data">
          <span>
            {BREAKDOWN_LABELS[breakdown.metric]}, last {RECENT_DAYS} days:
          </span>
          <Muted>
            {breakdown.values.map(({ dimension, value }) => `${dimension} ${value}`).join(" · ")}
          </Muted>
        </p>
      ))}
    </div>
  );
}

const BREAKDOWN_LABELS: Record<BreakdownMetric, string> = {
  leads_by_channel: "Leads by channel",
  leads_by_heard_about: "Leads by how they heard",
  page_views_by_ad_consent: "Page views by ad consent",
};

/** The site-side work each tier needs, which provisioning never does. */
const SITE_WORK: Record<SiteDetail["measurementTier"], string[]> = {
  essentials: [
    "The contract package installed, with page types, call-to-action markers and the server-side lead.",
    "A privacy page naming PostHog, with the objection control, linked from every page.",
  ],
  insights: [
    "Everything Essentials needs.",
    "A consent banner with a session recordings category.",
    "startRecording() called when a visitor accepts, stopRecording() when they withdraw.",
    "The privacy page naming session recording.",
  ],
  growth: [
    "Everything Insights needs.",
    "An advertising category in the banner.",
    "Each ad platform loaded only after consent, with Google Consent Mode.",
    "Conversions reported under the contract's names.",
    "The privacy page naming each ad platform.",
  ],
};

const RUN_OUTCOME_LABELS: Record<LatestRun["outcome"], string> = {
  matched: "matched",
  differs: "differences found",
  applied: "applied",
  partial: "applied in part",
  failed: "failed",
};

const MANUAL_STEPS = [
  "The PostHog organisation, owned by the client",
  "Billing",
  "The data processing agreement",
  "The reverse proxy's DNS record",
  "The read-only key for the nightly pull",
];

function ProjectSection({
  site,
  lastRun,
  clientOwned,
}: {
  site: SiteDetail;
  lastRun: LatestRun | null;
  clientOwned: boolean;
}) {
  if (!site.posthog) {
    return (
      <p className="text-data">
        <Muted>
          {clientOwned
            ? "This client runs PostHog themselves, so Open Waters does not provision it."
            : "Connect PostHog above first, so provisioning knows which project it is."}
        </Muted>
      </p>
    );
  }
  const tier = site.measurementTier;
  const confirmed = tier === "essentials" || site.tierConfirmation?.tier === tier;

  return (
    <div className="flex flex-col gap-4">
      <DescriptionList
        items={[
          {
            term: "Project",
            value: `${site.posthog.projectId} · ${REGION_LABELS[site.posthog.region]}`,
          },
          {
            term: "Last run",
            value: lastRun ? (
              `${lastRun.kind === "apply" ? "Applied" : "Checked"} ${formatRelative(lastRun.runAt)}: ${RUN_OUTCOME_LABELS[lastRun.outcome]}, against event list version ${lastRun.taxonomyVersion}`
            ) : (
              <Muted>Never checked</Muted>
            ),
          },
          {
            term: "Tier",
            value:
              tier === "essentials" ? (
                TIER_LABELS[tier]
              ) : confirmed && site.tierConfirmation ? (
                `${TIER_LABELS[tier]}, confirmed ${formatDateTime(site.tierConfirmation.at)}${site.tierConfirmation.byEmail ? ` by ${site.tierConfirmation.byEmail}` : ""}`
              ) : (
                <StatusDot
                  tone="warning"
                  label={`${TIER_LABELS[tier]}, not confirmed: recording stays off`}
                />
              ),
          },
        ]}
      />

      {!confirmed ? (
        <Disclosure summary={`Confirm the ${TIER_LABELS[tier]} tier`} open>
          <RegistryForm
            action={confirmTierAction.bind(null, site.id)}
            fields={[
              { kind: "hidden", name: "tier", value: tier },
              {
                kind: "checkbox",
                name: "bannerLive",
                label: "The consent banner is live on the production site",
                hint: `With the categories ${TIER_LABELS[tier]} needs.`,
              },
              {
                kind: "checkbox",
                name: "privacyPageNamesTools",
                label: "The privacy page names the tools this tier adds",
              },
            ]}
            submitLabel="Confirm tier"
          />
        </Disclosure>
      ) : null}

      <Disclosure summary={`Work on the client's site for ${TIER_LABELS[tier]}`}>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-data">
          {SITE_WORK[tier].map(item => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Disclosure>

      <Disclosure summary="Steps provisioning does not do">
        <ul className="flex list-disc flex-col gap-1 pl-5 text-data">
          {MANUAL_STEPS.map(item => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-2 text-caption text-ink-muted">
          The setup order in the openwaters-analytics skill has each one.
        </p>
      </Disclosure>

      <ProvisioningPanel action={provisioningAction.bind(null, site.id)} scopes={REQUIRED_SCOPES} />
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-hairline pt-6">
      <h3 className="text-label text-ink-muted uppercase">{title}</h3>
      {children}
    </div>
  );
}

/** Native <details>: keyboard accessible and needs no JavaScript. */
function Disclosure({
  summary,
  open,
  children,
}: {
  summary: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-md border border-hairline" open={open}>
      <summary className="cursor-pointer list-none px-3 py-2 text-data font-medium select-none marker:hidden hover:bg-surface-hover">
        <span
          aria-hidden="true"
          className="mr-2 inline-block transition-transform group-open:rotate-90"
        >
          ›
        </span>
        {summary}
      </summary>
      <div className="border-t border-hairline p-3">{children}</div>
    </details>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-ink-muted">{children}</span>;
}
