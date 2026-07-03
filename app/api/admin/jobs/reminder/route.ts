/**
 * POST /api/admin/jobs/reminder — manually force the end-of-week reminder job.
 *
 * Admin-only, no request body: resolves the dev actor, checks admin privileges
 * via requireAdminActor, then delegates to the sendEndOfWeekReminders job. Auth
 * failures → 403; job rejection → 400. Bypasses cron timing.
 */

import { sendEndOfWeekReminders } from "@/lib/jobs";
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
    const summary = await sendEndOfWeekReminders();
    return Response.json(summary, { status: HTTP_OK });
  } catch (err) {
    return mapAdminError(err);
  }
}
