/**
 * GET /api/admin/week/draft — return the draft questions for the upcoming week.
 *
 * Orchestrates the HTTP edge only: resolves the dev actor, checks admin
 * privileges via requireAdminActor, then delegates to gameService.getDraftQuestions.
 * Auth failures map to 403; any other error maps to 400 (consistent with peer
 * admin routes). Business logic lives entirely in the service.
 */

import { gameService } from "@/lib/services";
import { UPCOMING_WEEK_ID } from "@/lib/types";
import {
  HTTP_OK,
  HTTP_BAD_REQUEST,
  requireAdminActor,
  mapAdminError,
} from "@/lib/use-cases/adminApi";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(_request: Request): Promise<Response> {
  // --- Authorization: admin-only endpoint ---------------------------------
  const authResult = await requireAdminActor();
  if (!authResult.ok) {
    return authResult.response;
  }

  // --- Fetch draft questions from the service -----------------------------
  try {
    const questions = await gameService.getDraftQuestions(UPCOMING_WEEK_ID);
    return Response.json(
      { weekId: UPCOMING_WEEK_ID, questions },
      { status: HTTP_OK },
    );
  } catch (err) {
    return mapAdminError(err);
  }
}
