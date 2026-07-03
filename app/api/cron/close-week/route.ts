/**
 * GET /api/cron/close-week — Vercel Cron entry point (slice 13).
 *
 * Schedule (UTC, from vercel.json): "59 23 * * 0" — every Sunday 23:59.
 *
 * Verifies the Vercel Cron bearer via isAuthorizedCron, then delegates to the
 * closeOpenWeek job (closes the past-end open week and DMs results).
 * Unauthorized → 401 and the job is NOT invoked.
 */

import { isAuthorizedCron } from "@/lib/cronAuth";
import { closeOpenWeek } from "@/lib/jobs";

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
  const summary = await closeOpenWeek();
  return Response.json(summary, { status: HTTP_OK });
}
