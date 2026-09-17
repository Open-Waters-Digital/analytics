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
cp .env.example .env.local # then fill in anything marked required
pnpm db:migrate
pnpm dev                   # http://localhost:3000
```

The design system showcase is at `/design-system`.

## Before calling anything done

```bash
pnpm run ci:quality        # lint, typecheck, test, format check, build
```

## Deploy

Railway builds the `Dockerfile`, runs `node dist/migrate.mjs` as the
pre-deploy command (a failing migration stops the deploy), then starts
`node server.js` with a health check on `/api/health`. Those settings live in
`.railway/railway.ts` and are applied with the Railway CLI, not by pushing. The
build never needs the database. See AGENTS.md → Deploy.

### Setting up the Railway project

1. New project → Deploy from GitHub repo → this repository.
2. Add a Postgres service to the same project.
3. On the app service, set every variable in `.env.example`, with
   `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`.
4. `railway link` to the project, then `railway config plan`. Check it only
   changes build and deploy settings, then `railway config apply`.
5. Deploy. The deploy logs show `migrate: applied N` (or `migrate: up to date`)
   before the server starts.
6. Generate a Railway domain and check `/api/health`.
