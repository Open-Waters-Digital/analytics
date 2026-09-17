# Context

The vocabulary of this project. Specs, code and UI copy use these terms and
mean exactly this by them.

## Terms

**Client**
A business Open Waters builds or runs a site for. The unit of ownership and of
reporting. Identified by a **slug** (`radara`) that matches `SITE_SLUG` in the
client's site code.

**Site**
One production website belonging to a client. A client can have several.
Tracking, connections and snapshots belong to a site, not to a client.

**Analytics ownership**
Who controls a site's PostHog organisation. `open_waters`: set up and read by
Open Waters. `client_owned`: the client runs PostHog themselves (Agency Tap);
the site stays in the registry for its learning log and case study but is read
only if the client shares a key.

**Connection**
Stored access to one external data source for one site: a PostHog project or a
Search Console property. Carries its own last-check result.

**Check**
A live, read-only call that proves a connection works right now. Runs when a
connection is saved, on demand, and before every nightly pull.

**Event list** (taxonomy)
The shared set of event names and properties every Open Waters site sends,
versioned (`taxonomy_version`). Defined in the `openwaters-analytics` skill,
never in this app.

**Expected events**
The subset of the event list a particular site should send. A site with no
downloads does not expect `file_downloaded`.

**Drift**
A difference between the event list and what a site actually sent: an event
name not on the list, or an expected event that stopped arriving.

**Snapshot**
The day's aggregate numbers for one site, stored here so reports and trends do
not re-query PostHog. Never contains an individual visitor's data.

**Learning log** (site change)
A dated record of something that changed on a site or around it: a launch, a
new proposition, a campaign. Reports use it to connect a change to what
followed.

**Commercial context**
Figures that turn activity into money: average lead value, lead-to-customer
rate, and whether each is client-confirmed or an Open Waters estimate.

**Report**
The monthly, human-reviewed write-up for a client, structured Attention →
Intent → Action → Revenue → Intelligence. Not built yet.

## Decisions

Recorded as ADRs in `docs/adr/`.
