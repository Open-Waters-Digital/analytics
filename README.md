# Open Waters Analytics

The internal app at `analytics.openwaters.digital`: the client registry, each
client's analytics in one place, tracking health checks and, later, the monthly
client reports.

Read [`AGENTS.md`](AGENTS.md) first. It covers scope, the delivery order and the
standards every change is held to.

## Run it locally

Needs Node 22.12+, pnpm 11 and Docker.

```bash
pnpm install
pnpm db:up                 # Postgres 17 on localhost:5433
cp env.example .env.local  # then fill in anything marked required
pnpm db:migrate
pnpm dev                   # http://localhost:3000
```

The design system showcase is at `/design-system`.

## Before calling anything done

```bash
pnpm run ci:quality        # lint, typecheck, test, format check, build
```

## Deploy

Railway builds the `Dockerfile`. `railway.json` runs `node dist/migrate.mjs`
as the pre-deploy command, so a failing migration stops the deploy, then
starts `node server.js` with a health check on `/api/health`.
