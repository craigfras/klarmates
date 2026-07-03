/**
 * GET /api/admin/matchups — return the current week's matchup overview.
 *
 * Orchestrates the HTTP edge only: enforces admin via the shared
 * requireAdminActor guard (403 on non-admin), then delegates to
 * mockGameService.getAdminMatchups. Business logic lives in the service.
 */

import { gameService } from "@/lib/services";
import { requireAdminActor, HTTP_OK } from "@/lib/use-cases/adminApi";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(_request: Request): Promise<Response> {
  // --- Authorization: admin-only endpoint (shared guard) ------------------
  const auth = await requireAdminActor();
  if (!auth.ok) {
    return auth.response;
  }

  // --- Delegate to service -----------------------------------------------
  const overview = await gameService.getAdminMatchups();
  return Response.json(overview, { status: HTTP_OK });
}
