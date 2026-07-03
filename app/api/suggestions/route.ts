/**
 * POST /api/suggestions — player suggests a question.
 *
 * Orchestrates the HTTP edge only: resolves the current dev actor as the
 * suggester, validates the request shape, then delegates to
 * `gameService.suggestQuestion`. Non-admin endpoint (mirrors
 * app/api/me/answers/route.ts) — it does NOT require an admin actor.
 */

import { getDevActor } from "@/lib/use-cases/getDevActor";
import { gameService } from "@/lib/services";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;

const MALFORMED_BODY_MESSAGE = "Request body must be valid JSON.";
const MISSING_TEXT_MESSAGE = "A non-empty text is required.";
const SUBMIT_FAILED_MESSAGE = "Suggestion failed.";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  const { currentPlayer } = await getDevActor();

  // --- Safe body parse (malformed JSON maps to 400, never the service) --
  let text: unknown;
  try {
    ({ text } = (await request.json()) as { text?: unknown });
  } catch {
    return Response.json(
      { error: MALFORMED_BODY_MESSAGE },
      { status: HTTP_BAD_REQUEST },
    );
  }

  // --- Request-shape validation (no service call on missing/empty text) --
  // Whitespace-only text is deliberately NOT pre-empted here: it is a
  // service-level rule, so it reaches the service and its throw becomes a 400.
  if (typeof text !== "string" || text.length === 0) {
    return Response.json(
      { error: MISSING_TEXT_MESSAGE },
      { status: HTTP_BAD_REQUEST },
    );
  }

  // --- Delegate the rule; map violations to 400 -------------------------
  try {
    await gameService.suggestQuestion(currentPlayer.id, text);
    return Response.json({ ok: true }, { status: HTTP_OK });
  } catch (err) {
    const message = err instanceof Error ? err.message : SUBMIT_FAILED_MESSAGE;
    return Response.json({ error: message }, { status: HTTP_BAD_REQUEST });
  }
}
