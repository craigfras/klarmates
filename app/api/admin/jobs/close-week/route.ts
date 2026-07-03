/**
 * POST /api/admin/jobs/close-week — manually force-close the current open week.
 *
 * Admin-only, no request body: resolves the dev actor, checks admin privileges
 * via requireAdminActor, then delegates to the FORCE variant closeCurrentWeek
 * (close ANY open week regardless of endsAt), NOT the cron-guarded
 * closeOpenWeek. Auth failures → 403; job rejection → 400.
 */

import { closeCurrentWeek } from "@/lib/jobs";
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

  // --- Delegate to the FORCE job; map rejections to 400 -------------------
  try {
    const summary = await closeCurrentWeek();
    return Response.json(summary, { status: HTTP_OK });
  } catch (err) {
    return mapAdminError(err);
  }
}
