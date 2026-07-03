/**
 * GET /api/me/guess — fetch the current player's guess sheet.
 *
 * Orchestrates the HTTP edge only: resolves the dev actor, looks up their week
 * via the game service, then asks for the guess sheet. The not-unlocked rule
 * (and any other guard) surfaces as a 403.
 */

import { getDevActor } from "@/lib/use-cases/getDevActor";
import { gameService } from "@/lib/services";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;

const NOT_UNLOCKED_MESSAGE = "Guessing is not unlocked.";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(_request: Request): Promise<Response> {
  const { currentPlayerId } = await getDevActor();

  // --- Resolve the week, then derive the guess sheet --------------------
  const { weekId } = await gameService.getMyWeek(currentPlayerId);

  try {
    const sheet = await gameService.getGuessSheet(currentPlayerId, weekId);
    return Response.json(sheet, { status: HTTP_OK });
  } catch (err) {
    const message = err instanceof Error ? err.message : NOT_UNLOCKED_MESSAGE;
    return Response.json({ error: message }, { status: HTTP_FORBIDDEN });
  }
}
