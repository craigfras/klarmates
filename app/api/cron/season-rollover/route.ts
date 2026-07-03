/**
 * GET /api/cron/season-rollover — Vercel Cron entry point (slice 14).
 *
 * Schedule (UTC, from vercel.json): "0 0 1 1,4,7,10 *" — 00:00 on the 1st of
 * Jan/Apr/Jul/Oct, i.e. the START of each calendar quarter.
 *
 * Verifies the Vercel Cron bearer via isAuthorizedCron, then delegates to the
 * rolloverSeasonIfDue job (starts the next quarter's season when the current
 * one has expired). Idempotent: the endsOn expiry guard means a repeat run —
 * once the new season is current — no-ops. Unauthorized → 401 and the job is
 * NOT invoked.
 */

import { isAuthorizedCron } from "@/lib/cronAuth";
import { rolloverSeasonIfDue } from "@/lib/jobs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const UNAUTHORIZED_MESSAGE = "Unauthorized";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request)) {
    return Response.json(
      { error: UNAUTHORIZED_MESSAGE },
      { status: HTTP_UNAUTHORIZED },
    );
  }
  const summary = await rolloverSeasonIfDue(new Date());
  return Response.json(summary, { status: HTTP_OK });
}
