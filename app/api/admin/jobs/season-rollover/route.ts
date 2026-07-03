/**
 * POST /api/admin/jobs/season-rollover — manually force the season rollover.
 *
 * Admin-only, no request body: resolves the dev actor, checks admin privileges
 * via requireAdminActor, then delegates to the FORCE variant forceRolloverSeason
 * (roll over regardless of the isSeasonExpired guard), NOT the cron-guarded
 * rolloverSeasonIfDue. Auth failures → 403; job rejection → 400.
 */

import { forceRolloverSeason } from "@/lib/jobs";
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
    const summary = await forceRolloverSeason(new Date());
    return Response.json(summary, { status: HTTP_OK });
  } catch (err) {
    return mapAdminError(err);
  }
}
