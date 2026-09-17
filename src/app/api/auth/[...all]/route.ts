import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";

/**
 * Better Auth's endpoints (magic link request and verify, session, sign out).
 * The instance is created per call rather than at import, so `next build` can
 * analyse this route without secrets or a database.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}
