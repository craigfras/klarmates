/**
 * GET /api/me/history — the current player's past head-to-head recaps.
 *
 * Thin HTTP edge: resolves the dev actor and delegates to
 * `gameService.getMyHistory`.
 */

import { getDevActor } from "@/lib/use-cases/getDevActor";
import { gameService } from "@/lib/services";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HTTP_OK = 200;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(_request?: Request): Promise<Response> {
  const { currentPlayerId } = await getDevActor();

  const history = await gameService.getMyHistory(currentPlayerId);
  return Response.json(history, { status: HTTP_OK });
}
