/**
 * POST /api/admin/week/approve — approve the draft week and open it to players.
 *
 * Orchestrates the HTTP edge only: resolves the dev actor, checks admin
 * privileges via requireAdminActor, parses the request body, then delegates to
 * gameService.approveWeek. Auth failures → 403; malformed body /
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

  // --- Safe body parse (malformed JSON → 400, no approveWeek call) ------
  let weekId: string;
  try {
    ({ weekId } = (await request.json()) as { weekId: string });
  } catch {
    return Response.json(
      { error: MALFORMED_BODY_MESSAGE },
      { status: HTTP_BAD_REQUEST },
    );
  }

  // --- Delegate to service; map rejections to 400 -----------------------
  try {
    await gameService.approveWeek(weekId);
    return Response.json({ ok: true }, { status: HTTP_OK });
  } catch (err) {
    return mapAdminError(err);
  }
}
