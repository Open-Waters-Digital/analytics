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
import { buttonClasses, dotClasses, type Tone } from "@/components/ui/variants";
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
import { targets, type MetricVerdict, type Verdict } from "@/lib/page-experience";
import {
  getPageExperienceReport,
  type FormFactorReport,
  type PageExperienceReport,
} from "@/server/snapshots/page-experience-read";
import { getSearchReports, type Headline, type SearchReport } from "@/server/snapshots/search-read";
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
  checkBingSiteAction,
  checkSearchConsoleAction,
  runLabAction,
  saveBingSiteAction,
  saveSearchConsoleAction,
  setExpectedEventsAction,
  testPostHogAction,
} from "../actions";
import {
  commercialFields,
  posthogFields,
  recipientFields,
  bingSiteFields,
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
  const [snapshots, runs, searches, experiences] = await Promise.all([
    getSiteSnapshots(siteIds),
    latestProvisioningRuns(siteIds),
    getSearchReports(siteIds),
    Promise.all(siteIds.map(id => getPageExperienceReport(id))),
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
            search={searches.get(site.id) ?? null}
            experience={experiences[client.sites.indexOf(site)] ?? null}
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
  search,
  experience,
}: {
  client: ClientDetail;
  site: SiteDetail;
  snapshot: SiteSnapshot | null;
  lastRun: LatestRun | null;
  search: SearchReport | null;
  experience: PageExperienceReport | null;
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

          <SubSection title="Search">
            <SearchSection slug={slug} site={site} report={search} />
          </SubSection>

          <SubSection title="Page experience">
            {experience ? (
              <PageExperienceSection slug={slug} site={site} report={experience} />
            ) : null}
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

const SEARCH_STATUS: Record<
  "readable" | "no_access" | "check_failed",
  { tone: "success" | "warning" | "danger"; label: string }
> = {
  readable: { tone: "success", label: "Readable" },
  no_access: { tone: "warning", label: "No access" },
  check_failed: { tone: "danger", label: "Check failed" },
};

function PropertyLine({
  label,
  property,
  check,
}: {
  label: string;
  property: SiteDetail["searchConsole"];
  check: () => Promise<void>;
}) {
  if (!property) {
    return (
      <p className="text-data">
        {label}: <Muted>not recorded</Muted>
      </p>
    );
  }
  const status = property.status ? SEARCH_STATUS[property.status] : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-data">
        <span>{label}:</span>
        <code className="break-all">{property.value}</code>
        {status ? (
          <StatusDot tone={status.tone} label={status.label} />
        ) : (
          <Muted>Not checked</Muted>
        )}
        {property.checkedAt ? <Muted>· {formatDateTime(property.checkedAt)}</Muted> : null}
        <form action={check}>
          <Button type="submit" variant="ghost" size="sm">
            Check
          </Button>
        </form>
      </div>
      {property.message && property.status !== "readable" ? (
        <Alert tone={property.status === "no_access" ? "warning" : "danger"}>
          {property.message}
        </Alert>
      ) : null}
    </div>
  );
}

const number = (value: number) => new Intl.NumberFormat("en-GB").format(value);
const percent = (value: number | null) =>
  value === null
    ? "–"
    : new Intl.NumberFormat("en-GB", { style: "percent", maximumFractionDigits: 1 }).format(value);
const position = (value: number | null) => (value === null ? "Not reported" : value.toFixed(1));

function change(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "no change" : "new";
  const delta = (current - previous) / previous;
  return `${delta >= 0 ? "+" : ""}${new Intl.NumberFormat("en-GB", { style: "percent", maximumFractionDigits: 0 }).format(delta)}`;
}

function HeadlineRow({
  label,
  current,
  previous,
}: {
  label: string;
  current: Headline;
  previous: Headline;
}) {
  return (
    <Tr>
      <Td className="font-medium">{label}</Td>
      <Td className="text-right tabular-nums">
        {number(current.clicks)} <Muted>{change(current.clicks, previous.clicks)}</Muted>
      </Td>
      <Td className="text-right tabular-nums">{number(current.impressions)}</Td>
      <Td className="hidden text-right tabular-nums md:table-cell">{percent(current.ctr)}</Td>
      <Td className="hidden text-right tabular-nums md:table-cell">{position(current.position)}</Td>
    </Tr>
  );
}

function TopList({ title, rows }: { title: string; rows: SearchReport["topQueries"] }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-data font-medium">{title}</h4>
      <Table>
        <thead>
          <tr>
            <Th>{title === "Top queries" ? "Query" : "Page"}</Th>
            <Th className="text-right">Clicks</Th>
            <Th className="text-right">Impressions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <Tr key={row.value}>
              <Td className="break-all">{row.value}</Td>
              <Td className="text-right tabular-nums">{number(row.clicks)}</Td>
              <Td className="text-right tabular-nums">{number(row.impressions)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function SearchSection({
  slug,
  site,
  report,
}: {
  slug: string;
  site: SiteDetail;
  report: SearchReport | null;
}) {
  const hasData =
    report !== null &&
    (report.combined.current.impressions > 0 || report.combined.previous.impressions > 0);
  const readable = site.searchConsole?.status === "readable" || site.bing?.status === "readable";

  return (
    <div className="flex flex-col gap-4">
      <PropertyLine
        label="Google"
        property={site.searchConsole}
        check={checkSearchConsoleAction.bind(null, slug, site.id)}
      />
      <PropertyLine
        label="Bing"
        property={site.bing}
        check={checkBingSiteAction.bind(null, slug, site.id)}
      />

      {report && hasData ? (
        <div className="flex flex-col gap-4">
          <Table>
            <thead>
              <tr>
                <Th>Last 28 days</Th>
                <Th className="text-right">Clicks</Th>
                <Th className="text-right">Impressions</Th>
                <Th className="hidden text-right md:table-cell">Click-through</Th>
                <Th className="hidden text-right md:table-cell">Position</Th>
              </tr>
            </thead>
            <tbody>
              {report.google ? (
                <HeadlineRow
                  label="Google"
                  current={report.google.current}
                  previous={report.google.previous}
                />
              ) : null}
              {report.bing ? (
                <HeadlineRow
                  label="Bing"
                  current={report.bing.current}
                  previous={report.bing.previous}
                />
              ) : null}
              <HeadlineRow
                label="Both"
                current={report.combined.current}
                previous={report.combined.previous}
              />
            </tbody>
          </Table>
          <p className="text-caption text-ink-muted">
            {formatDate(report.period.from)} to {formatDate(report.period.to)}, against the 28 days
            before. Google&apos;s days are Pacific Time, eight hours behind the UK.
            {report.google?.historyBegins
              ? ` Google history begins ${formatDate(report.google.historyBegins)}.`
              : ""}
            {report.bing?.historyBegins
              ? ` Bing history begins ${formatDate(report.bing.historyBegins)}.`
              : ""}
            {report.previousSiteUntil
              ? ` Figures before ${formatDate(report.previousSiteUntil)} are the previous site's.`
              : ""}
          </p>

          <DescriptionList
            items={[
              {
                term: "Search to enquiry",
                value: `${number(report.searchToEnquiry.organicClicks)} clicks → ${number(report.searchToEnquiry.organicSessions)} organic sessions → ${number(report.searchToEnquiry.organicLeads)} enquiries`,
              },
              {
                term: "Branded",
                value: report.branded ? (
                  `${number(report.branded.branded)} branded, ${number(report.branded.nonBranded)} non-branded clicks${report.branded.coverage === null ? "" : `, based on ${percent(report.branded.coverage)} of clicks`}`
                ) : (
                  <Muted>Add brand terms to the site to split branded searches out</Muted>
                ),
              },
            ]}
          />

          <TopList title="Top queries" rows={report.topQueries} />
          <TopList title="Top pages" rows={report.topPages} />
        </div>
      ) : (
        <p className="text-data">
          <Muted>
            {!site.searchConsole && !site.bing
              ? "Record a Search Console property or a Bing site to see search data."
              : readable
                ? "Search data arrives after the next nightly run."
                : "Search data appears once a property is readable."}
          </Muted>
        </p>
      )}

      {report?.indexing ? (
        <div className="flex flex-col gap-2">
          <p className="text-data">
            Indexing: {report.indexing.indexed} of {report.indexing.inspected} sitemap pages indexed
            by Google.
          </p>
          {report.indexing.notIndexed.length > 0 ? (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-data">
              {report.indexing.notIndexed.slice(0, 20).map(page => (
                <li key={page.address} className="break-all">
                  {page.address}
                  {page.coverageState ? <Muted> · {page.coverageState}</Muted> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Disclosure
          summary={
            site.searchConsole ? "Change Search Console property" : "Add Search Console property"
          }
        >
          <RegistryForm
            action={saveSearchConsoleAction.bind(null, slug, site.id)}
            fields={searchConsoleFields(site)}
            submitLabel="Save and check"
          />
        </Disclosure>
        <Disclosure summary={site.bing ? "Change Bing site" : "Add Bing site"}>
          <RegistryForm
            action={saveBingSiteAction.bind(null, slug, site.id)}
            fields={bingSiteFields(site)}
            submitLabel="Save and check"
          />
        </Disclosure>
      </div>
    </div>
  );
}

const VERDICT_DISPLAY: Record<Verdict["outcome"], { tone: Tone; label: string }> = {
  passing: { tone: "success", label: "Passing" },
  failing: { tone: "danger", label: "Failing" },
  not_enough_data: { tone: "neutral", label: "Not enough Chrome traffic yet" },
  no_data: { tone: "neutral", label: "No field data yet" },
};

const METRIC_TONES: Record<MetricVerdict, Tone> = {
  pass: "success",
  fail: "danger",
  not_reported: "neutral",
};

const ms = (value: number | null) =>
  value === null ? "–" : value >= 1_000 ? `${(value / 1_000).toFixed(1)} s` : `${value} ms`;
const shift = (value: number | null) => (value === null ? "–" : value.toFixed(2));
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );

function VerdictLine({ label, report }: { label: string; report: FormFactorReport }) {
  const display = VERDICT_DISPLAY[report.verdict.outcome];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-ink-muted">{label}</span>
      <StatusDot
        tone={display.tone}
        label={
          report.verdict.outcome === "failing"
            ? `Failing on ${report.verdict.failing.join(", ")}`
            : display.label
        }
      />
    </div>
  );
}

function MetricCell({
  value,
  verdict,
  label,
}: {
  value: string;
  verdict: MetricVerdict;
  label: string;
}) {
  return (
    <Td className="text-right tabular-nums">
      {verdict === "not_reported" ? (
        <Muted>{value}</Muted>
      ) : (
        <span className="inline-flex items-center justify-end gap-2">
          <span aria-hidden="true" className={dotClasses(METRIC_TONES[verdict])} />
          {value}
          <span className="sr-only">
            {verdict === "pass" ? `, within ${label}` : `, outside ${label}`}
          </span>
        </span>
      )}
    </Td>
  );
}

function PageExperienceSection({
  slug,
  site,
  report,
}: {
  slug: string;
  site: SiteDetail;
  report: PageExperienceReport;
}) {
  const goal = targets(report.budget);
  const hasField = report.phone.latest !== null || report.desktop.latest !== null;
  const hasLab = report.lab.some(row => row.day !== null);
  const budgetNote = report.budget
    ? "Against this site's budget where it is stricter than Google's thresholds."
    : "Against Google's thresholds.";
  const metrics = [
    {
      name: "LCP",
      target: ms(goal.lcpMs),
      key: "lcp" as const,
      phone: ms(report.phone.latest?.lcpMs ?? null),
      desktop: ms(report.desktop.latest?.lcpMs ?? null),
      trend: (row: FormFactorReport["months"][number]) => ms(row.lcpMs),
    },
    {
      name: "INP",
      target: ms(goal.inpMs),
      key: "inp" as const,
      phone: ms(report.phone.latest?.inpMs ?? null),
      desktop: ms(report.desktop.latest?.inpMs ?? null),
      trend: (row: FormFactorReport["months"][number]) => ms(row.inpMs),
    },
    {
      name: "CLS",
      target: shift(goal.cls),
      key: "cls" as const,
      phone: shift(report.phone.latest?.cls ?? null),
      desktop: shift(report.desktop.latest?.cls ?? null),
      trend: (row: FormFactorReport["months"][number]) => shift(row.cls),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {!report.configured ? (
        <Alert tone="warning">
          Page experience is not configured on the server. Set GOOGLE_API_KEY on the web and jobs
          services.
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 md:flex-row md:gap-8">
        <VerdictLine label="Phones" report={report.phone} />
        <VerdictLine label="Desktops" report={report.desktop} />
      </div>

      {hasField ? (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Metric</Th>
                <Th className="text-right">Phone</Th>
                <Th className="text-right">Desktop</Th>
                <Th className="hidden text-right md:table-cell">Target</Th>
              </tr>
            </thead>
            <tbody>
              {metrics.map(metric => (
                <Tr key={metric.name}>
                  <Td className="font-medium">{metric.name}</Td>
                  <MetricCell
                    value={metric.phone}
                    verdict={report.phone.verdict.metrics[metric.key]}
                    label={`the ${metric.target} target`}
                  />
                  <MetricCell
                    value={metric.desktop}
                    verdict={report.desktop.verdict.metrics[metric.key]}
                    label={`the ${metric.target} target`}
                  />
                  <Td className="hidden text-right tabular-nums md:table-cell">{metric.target}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <p className="text-caption text-ink-muted">
            Real Chrome visitors at the 75th percentile, over the rolling 28 days to{" "}
            {formatDate((report.phone.latest ?? report.desktop.latest)!.day)}. {budgetNote}
          </p>

          {report.phone.months.length > 1 ? (
            <div className="flex flex-col gap-2">
              <h4 className="text-data font-medium">Phones, month by month</h4>
              <Table>
                <thead>
                  <tr>
                    <Th>Metric</Th>
                    {report.phone.months.map(row => (
                      <Th key={row.month} className="text-right">
                        {monthLabel(row.month)}
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metrics.map(metric => (
                    <Tr key={metric.name}>
                      <Td className="font-medium">{metric.name}</Td>
                      {report.phone.months.map(row => (
                        <Td key={row.month} className="text-right tabular-nums">
                          {metric.trend(row)}
                        </Td>
                      ))}
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-data">
          <Muted>
            {report.phone.verdict.outcome === "not_enough_data"
              ? "Chrome does not have enough visits to this site to report on it yet. The lab runs below still measure it."
              : "Field data arrives after the next nightly run."}
          </Muted>
        </p>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-data font-medium">Lab, on a phone</h4>
          {report.runInProgress ? (
            <StatusDot tone="info" label="Run in progress. Reload to see results." />
          ) : (
            <form action={runLabAction.bind(null, slug, site.id)}>
              <Button type="submit" variant="secondary" size="sm" disabled={!report.configured}>
                Run now
              </Button>
            </form>
          )}
        </div>
        {hasLab || report.runInProgress ? (
          <Table>
            <thead>
              <tr>
                <Th>Page</Th>
                <Th className="text-right">Score</Th>
                <Th className="hidden text-right md:table-cell">LCP</Th>
                <Th className="hidden text-right md:table-cell">TBT</Th>
                <Th className="hidden text-right md:table-cell">CLS</Th>
                <Th className="hidden text-right md:table-cell">Run</Th>
              </tr>
            </thead>
            <tbody>
              {report.lab.map(row => (
                <Tr key={row.path}>
                  <Td className="break-all">{row.path}</Td>
                  <Td className="text-right tabular-nums">
                    {row.failed ? (
                      <Muted>Did not load</Muted>
                    ) : row.score === null ? (
                      <Muted>–</Muted>
                    ) : row.belowTarget ? (
                      <Badge tone="warning">{row.score}</Badge>
                    ) : (
                      row.score
                    )}
                  </Td>
                  <Td className="hidden text-right tabular-nums md:table-cell">{ms(row.lcpMs)}</Td>
                  <Td className="hidden text-right tabular-nums md:table-cell">{ms(row.tbtMs)}</Td>
                  <Td className="hidden text-right tabular-nums md:table-cell">{shift(row.cls)}</Td>
                  <Td className="hidden text-right md:table-cell">
                    {row.day ? formatDate(row.day) : <Muted>Not yet</Muted>}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="text-data">
            <Muted>No lab runs yet. They run every Monday, or press Run now.</Muted>
          </p>
        )}
        <p className="text-caption text-ink-muted">
          One Lighthouse run per page, on a simulated mid-range phone. A single run varies by a few
          points; a score below {goal.labScore} is marked.
        </p>
      </div>
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
