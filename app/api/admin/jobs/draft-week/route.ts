/**
 * POST /api/admin/jobs/draft-week — manually force the draft-week scheduled job.
 *
 * Admin-only, no request body: resolves the dev actor, checks admin privileges
 * via requireAdminActor, then delegates to the draftNextWeek job. Auth failures
 * → 403; job rejection → 400. Bypasses cron timing for on-demand triggering.
 */

import { draftNextWeek } from "@/lib/jobs";
import {
  HTTP_OK,
  requireAdminActor,
  mapAdminError,
} from "@/lib/use-cases/adminApi";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(_request: Request): Promise<Response> {
  // --- Authorization: admin-only endpoint ---------------------------------
  const authResult = await requireAdminActor();
  if (!authResult.ok) {
    return authResult.response;
  }

  // --- Delegate to the job; map rejections to 400 -------------------------
  try {
    const summary = await draftNextWeek();
    return Response.json(summary, { status: HTTP_OK });
  } catch (err) {
    return mapAdminError(err);
  }
}
