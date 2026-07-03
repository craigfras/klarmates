/**
 * POST /api/me/answers — submit the current player's weekly answers.
 *
 * Orchestrates the HTTP edge only: resolves the dev actor, validates the request
 * shape, then delegates the game rules to `gameService.submitAnswers`. On
 * success it returns the freshly derived `MyWeekView`; any rule violation maps to
 * a 400 with the thrown message.
 */

import { after } from "next/server";
import { getDevActor } from "@/lib/use-cases/getDevActor";
import { gameService } from "@/lib/services";
import { WEEKLY_QUESTION_COUNT } from "@/lib/types";
import type { AnswerSubmission } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;

const MALFORMED_BODY_MESSAGE = "Request body must be valid JSON.";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  const { currentPlayerId } = await getDevActor();

  // --- Safe body parse (malformed JSON maps to 400, never the service) --
  let weekId: string;
  let answers: AnswerSubmission[];
  try {
    ({ weekId, answers } = (await request.json()) as {
      weekId: string;
      answers: AnswerSubmission[];
    });
  } catch {
    return Response.json(
      { error: MALFORMED_BODY_MESSAGE },
      { status: HTTP_BAD_REQUEST },
    );
  }

  // --- Request-shape validation (no service call on bad shape) ----------
  if (!Array.isArray(answers) || answers.length !== WEEKLY_QUESTION_COUNT) {
    return Response.json(
      { error: `Expected exactly ${WEEKLY_QUESTION_COUNT} answers.` },
      { status: HTTP_BAD_REQUEST },
    );
  }

  // --- Delegate game rules; map violations to 400 -----------------------
  try {
    await gameService.submitAnswers(currentPlayerId, weekId, answers);

    // --- Fire-and-forget background option generation ---------------------
    // Submitting stays instant: the slow AI option generation is scheduled to
    // run AFTER the response is sent. This is a fire-and-forget effect — its
    // rejection must never affect the response (getGuessSheet lazily ensures
    // options as the correctness backstop). `after` owns the returned promise,
    // so we do NOT await it here. Scheduling belongs at the HTTP edge, not in
    // the service.
    after(() => gameService.ensureAnswerOptions(currentPlayerId, weekId));

    const view = await gameService.getMyWeek(currentPlayerId);
    return Response.json(view, { status: HTTP_OK });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Submission failed.";
    return Response.json({ error: message }, { status: HTTP_BAD_REQUEST });
  }
}
