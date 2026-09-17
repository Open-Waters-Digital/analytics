import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DescriptionList } from "@/components/ui/description-list";
import { Field } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { Tone } from "@/components/ui/variants";
import { Entry, Row, Section } from "@/components/showcase/showcase";

export const metadata: Metadata = { title: "Design system" };

// Literal class strings: Tailwind cannot see interpolated names.
const swatches = [
  { name: "surface", className: "bg-surface" },
  { name: "surface-raised", className: "bg-surface-raised" },
  { name: "surface-sunken", className: "bg-surface-sunken" },
  { name: "surface-hover", className: "bg-surface-hover" },
  { name: "selection", className: "bg-selection" },
  { name: "ink", className: "bg-ink" },
  { name: "ink-hover", className: "bg-ink-hover" },
  { name: "ink-muted", className: "bg-ink-muted" },
  { name: "ink-subtle", className: "bg-ink-subtle" },
  { name: "hairline", className: "bg-hairline" },
  { name: "border", className: "bg-border" },
  { name: "success", className: "bg-success" },
  { name: "success-subtle", className: "bg-success-subtle" },
  { name: "warning", className: "bg-warning" },
  { name: "warning-subtle", className: "bg-warning-subtle" },
  { name: "danger", className: "bg-danger" },
  { name: "danger-subtle", className: "bg-danger-subtle" },
  { name: "info", className: "bg-info" },
  { name: "info-subtle", className: "bg-info-subtle" },
];

const typeScale = [
  { name: "text-display", className: "text-display" },
  { name: "text-title", className: "text-title" },
  { name: "text-body", className: "text-body" },
  { name: "text-data", className: "text-data" },
  { name: "text-caption", className: "text-caption" },
  { name: "text-label", className: "text-label uppercase" },
];

const tones: Tone[] = ["neutral", "success", "warning", "danger", "info"];

const frameworkOptions = [
  { value: "astro", label: "Astro" },
  { value: "next", label: "Next.js" },
  { value: "other", label: "Other" },
];
const currencyOptions = [
  { value: "GBP", label: "GBP (£)" },
  { value: "EUR", label: "EUR (€)" },
  { value: "USD", label: "USD ($)" },
];
const regionOptions = [
  { value: "eu", label: "EU" },
  { value: "us", label: "US" },
];

export default function DesignSystemPage() {
  return (
    <main className="mx-auto max-w-(--container-max) px-(--gutter) py-8">
      <h1 className="text-display">Design system</h1>
      <p className="mt-2 text-ink-muted">
        Every primitive with every variant, size and state. A component is not done until it is
        here.
      </p>

      <Section title="Colour" importPath="src/styles/tokens.css">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {swatches.map(swatch => (
            <div key={swatch.name} className="flex flex-col gap-1.5">
              <div className={`h-12 rounded-md border border-hairline ${swatch.className}`} />
              <code className="text-caption">{swatch.name}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type scale" importPath="src/styles/tokens.css">
        {typeScale.map(step => (
          <Entry key={step.name} code={step.name}>
            <p className={step.className}>Radara enquiries up 18% month on month</p>
          </Entry>
        ))}
      </Section>

      <Section title="Button" importPath="@/components/ui/button">
        <Row label="Variant">
          <Entry code='variant="primary"'>
            <Button>Save client</Button>
          </Entry>
          <Entry code='variant="secondary"'>
            <Button variant="secondary">Test connection</Button>
          </Entry>
          <Entry code='variant="ghost"'>
            <Button variant="ghost">Cancel</Button>
          </Entry>
          <Entry code='variant="danger"'>
            <Button variant="danger">Remove key</Button>
          </Entry>
        </Row>
        <Row label="Size">
          <Entry code='size="md"'>
            <Button>Medium</Button>
          </Entry>
          <Entry code='size="sm"'>
            <Button size="sm">Small</Button>
          </Entry>
        </Row>
        <Row label="State">
          <Entry code="disabled">
            <Button disabled>Disabled</Button>
          </Entry>
        </Row>
      </Section>

      <Section title="Badge" importPath="@/components/ui/badge">
        <Row label="Tone">
          {tones.map(tone => (
            <Entry key={tone} code={`tone="${tone}"`}>
              <Badge tone={tone}>{tone}</Badge>
            </Entry>
          ))}
        </Row>
      </Section>

      <Section title="StatusDot" importPath="@/components/ui/badge">
        <Row label="Tone">
          {tones.map(tone => (
            <Entry key={tone} code={`tone="${tone}"`}>
              <StatusDot tone={tone} label={tone} />
            </Entry>
          ))}
        </Row>
      </Section>

      <Section title="Field" importPath="@/components/ui/field">
        <Row label="State">
          <Entry code="default">
            <Field label="Client name" placeholder="Radara Health" />
          </Entry>
          <Entry code="hint">
            <Field label="Slug" hint="Matches SITE_SLUG in the site's code" defaultValue="radara" />
          </Entry>
          <Entry code="error">
            <Field
              label="Project ID"
              error="PostHog could not find this project"
              defaultValue="0"
            />
          </Entry>
          <Entry code="disabled">
            <Field label="Region" disabled defaultValue="eu" />
          </Entry>
        </Row>
      </Section>

      <Section title="Select" importPath="@/components/ui/select">
        <Row label="State">
          <Entry code="default">
            <Select label="Framework" options={frameworkOptions} defaultValue="astro" />
          </Entry>
          <Entry code="placeholder + hint">
            <Select
              label="Currency"
              placeholder="Choose…"
              options={currencyOptions}
              hint="Required with a lead value"
              defaultValue=""
            />
          </Entry>
          <Entry code="error">
            <Select label="Region" options={regionOptions} error="Choose a region." />
          </Entry>
          <Entry code="disabled">
            <Select label="Region" options={regionOptions} disabled defaultValue="eu" />
          </Entry>
        </Row>
      </Section>

      <Section title="Textarea" importPath="@/components/ui/textarea">
        <Row label="State">
          <Entry code="default">
            <Textarea label="Detail" placeholder="What changed, and why" />
          </Entry>
          <Entry code="hint">
            <Textarea label="Expected effect" hint="What should move if this works" />
          </Entry>
          <Entry code="error">
            <Textarea label="Detail" error="Keep the detail to 2000 characters or fewer." />
          </Entry>
          <Entry code="disabled">
            <Textarea label="Detail" disabled defaultValue="Read only" />
          </Entry>
        </Row>
      </Section>

      <Section title="Checkbox" importPath="@/components/ui/checkbox">
        <Row label="State">
          <Entry code="unchecked">
            <Checkbox label="Regulated" />
          </Entry>
          <Entry code="checked + hint">
            <Checkbox label="file_downloaded" hint="Intent" defaultChecked />
          </Entry>
          <Entry code="disabled">
            <Checkbox label="deal_won" disabled />
          </Entry>
        </Row>
      </Section>

      <Section title="Alert" importPath="@/components/ui/alert">
        <Row label="Tone">
          <Entry code='tone="info"'>
            <Alert tone="info">Search Console is not checked yet.</Alert>
          </Entry>
          <Entry code='tone="success"'>
            <Alert tone="success">Connected to PostHog.</Alert>
          </Entry>
          <Entry code='tone="warning"'>
            <Alert tone="warning">No PostHog connection.</Alert>
          </Entry>
          <Entry code='tone="danger"'>
            <Alert tone="danger">PostHog could not be reached. Try again in a minute.</Alert>
          </Entry>
        </Row>
      </Section>

      <Section title="DescriptionList" importPath="@/components/ui/description-list">
        <DescriptionList
          items={[
            { term: "Production URL", value: "https://radarahealth.com" },
            { term: "Framework", value: "Astro" },
            { term: "Event list", value: "Version 1" },
            { term: "PostHog", value: <StatusDot tone="success" label="Connected" /> },
          ]}
        />
      </Section>

      <Section title="Panel" importPath="@/components/ui/panel">
        <Row label="Variant">
          <Entry code="title + actions">
            <Panel
              title="PostHog connection"
              actions={
                <Button size="sm" variant="secondary">
                  Test
                </Button>
              }
            >
              <StatusDot tone="success" label="Connected" />
            </Panel>
          </Entry>
          <Entry code="no title">
            <Panel>Body only</Panel>
          </Entry>
        </Row>
      </Section>

      <Section title="Table" importPath="@/components/ui/table">
        <Table>
          <thead>
            <tr>
              <Th>Client</Th>
              <Th>Status</Th>
              <Th>PostHog</Th>
            </tr>
          </thead>
          <tbody>
            <Tr>
              <Td>Radara Health</Td>
              <Td>
                <Badge tone="info">onboarding</Badge>
              </Td>
              <Td>
                <StatusDot tone="warning" label="Not connected" />
              </Td>
            </Tr>
            <Tr>
              <Td>Luxury Gardens</Td>
              <Td>
                <Badge tone="success">active</Badge>
              </Td>
              <Td>
                <StatusDot tone="success" label="Connected" />
              </Td>
            </Tr>
          </tbody>
        </Table>
      </Section>
    </main>
  );
}
