/**
 * Liveness only: the process is up and serving. Deliberately does not touch the
 * database, so a brief Postgres blip does not make Railway restart a healthy
 * container. Database reachability is proven by the pre-deploy migration step.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
