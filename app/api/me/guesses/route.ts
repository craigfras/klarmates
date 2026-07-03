/**
 * POST /api/me/guesses — submit one guess for the current player.
 *
 * Orchestrates the HTTP edge only: resolves the dev actor, safe-parses and
 * validates the request shape, then delegates the game rules to
 * `gameService.submitGuess`. Malformed bodies and missing fields map to 400
 * before any service call; rule violations map to 400 with the thrown message.
 */

import { getDevActor } from "@/lib/use-cases/getDevActor";
import { gameService } from "@/lib/services";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;

const MALFORMED_BODY_MESSAGE = "Request body must be valid JSON.";
const MISSING_FIELDS_MESSAGE =
  "weekId, questionId and chosenOptionId are required.";
const SUBMISSION_FAILED_MESSAGE = "Guess submission failed.";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  const { currentPlayerId } = await getDevActor();

  // --- Safe body parse (malformed JSON maps to 400, never the service) --
  let weekId: string;
  let questionId: string;
  let chosenOptionId: string;
  try {
    ({ weekId, questionId, chosenOptionId } = (await request.json()) as {
      weekId: string;
      questionId: string;
      chosenOptionId: string;
    });
  } catch {
    return Response.json(
      { error: MALFORMED_BODY_MESSAGE },
      { status: HTTP_BAD_REQUEST },
    );
  }

  // --- Request-shape validation (no service call on bad shape) ----------
  if (
    typeof weekId !== "string" ||
    typeof questionId !== "string" ||
    typeof chosenOptionId !== "string"
  ) {
    return Response.json(
      { error: MISSING_FIELDS_MESSAGE },
      { status: HTTP_BAD_REQUEST },
    );
  }

  // --- Delegate game rules; map violations to 400 -----------------------
  try {
    const result = await gameService.submitGuess(
      currentPlayerId,
      weekId,
      questionId,
      chosenOptionId,
    );
    return Response.json(result, { status: HTTP_OK });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : SUBMISSION_FAILED_MESSAGE;
    return Response.json({ error: message }, { status: HTTP_BAD_REQUEST });
  }
}
