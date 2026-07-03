/**
 * GET /api/cron/draft-week — Vercel Cron entry point (slice 13).
 *
 * Schedule (UTC, from vercel.json): "0 12 * * 6" — every Saturday 12:00.
 *
 * Verifies the Vercel Cron bearer via isAuthorizedCron, then delegates to the
 * draftNextWeek job (idempotently ensures the upcoming week's draft questions
 * exist). Unauthorized → 401 and the job is NOT invoked.
 */

import { isAuthorizedCron } from "@/lib/cronAuth";
import { draftNextWeek } from "@/lib/jobs";

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
  const summary = await draftNextWeek();
  return Response.json(summary, { status: HTTP_OK });
}
