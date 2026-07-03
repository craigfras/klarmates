/**
 * POST /api/admin/week/absences — record absent player ids for the upcoming week.
 *
 * Orchestrates the HTTP edge only: resolves the dev actor, checks admin
 * privileges via requireAdminActor, parses the request body, then delegates to
 * gameService.setWeekAbsences. Auth failures → 403; malformed body /
 * service rejection → 400. Business logic lives in the service.
 */

import { gameService } from "@/lib/services";
import {
  HTTP_OK,
  HTTP_BAD_REQUEST,
  MALFORMED_BODY_MESSAGE,
  requireAdminActor,
  mapAdminError,
} from "@/lib/use-cases/adminApi";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  // --- Authorization: admin-only endpoint ---------------------------------
  const authResult = await requireAdminActor();
  if (!authResult.ok) {
    return authResult.response;
  }

  // --- Safe body parse (malformed JSON → 400, no service call) ----------
  let weekId: string;
  let absentPlayerIds: string[];
  try {
    ({ weekId, absentPlayerIds } = (await request.json()) as {
      weekId: string;
      absentPlayerIds: string[];
    });
  } catch {
    return Response.json(
      { error: MALFORMED_BODY_MESSAGE },
      { status: HTTP_BAD_REQUEST },
    );
  }

  // --- Delegate to service; map rejections to 400 -----------------------
  try {
    await gameService.setWeekAbsences(weekId, absentPlayerIds);
    return Response.json({ ok: true }, { status: HTTP_OK });
  } catch (err) {
    return mapAdminError(err);
  }
}
