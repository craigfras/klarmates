/**
 * POST /api/admin/suggestions — use a suggestion into a draft slot, or discard it.
 *
 * Orchestrates the HTTP edge only: resolves the dev actor, checks admin
 * privileges, parses and validates the request body, then delegates to
 * gameService. Auth failures → 403; malformed body / unknown action / missing
 * field / service rejection → 400. Business logic lives in the service.
 *
 * Deliberately NOT folded into the draft-questions route: the `remove` action
 * does not touch the draft, so it warrants its own endpoint.
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
// Constants
// ---------------------------------------------------------------------------

const ACTION_USE = "use";
const ACTION_REMOVE = "remove";
const VALID_ACTIONS = [ACTION_USE, ACTION_REMOVE] as const;

const MISSING_SUGGESTION_MESSAGE = "Field 'suggestionId' is required.";
const MISSING_DRAFT_QUESTION_MESSAGE =
  "Field 'draftQuestionId' is required for the 'use' action.";
const UNKNOWN_ACTION_MESSAGE = `Action must be one of: ${VALID_ACTIONS.join(", ")}.`;

type ValidAction = (typeof VALID_ACTIONS)[number];

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  // --- Authorization: admin-only endpoint ---------------------------------
  const authResult = await requireAdminActor();
  if (!authResult.ok) {
    return authResult.response;
  }

  // --- Safe body parse (malformed JSON → 400, no service call) -----------
  let action: unknown;
  let suggestionId: unknown;
  let draftQuestionId: unknown;
  try {
    ({ action, suggestionId, draftQuestionId } = (await request.json()) as {
      action: unknown;
      suggestionId: unknown;
      draftQuestionId?: unknown;
    });
  } catch {
    return Response.json(
      { error: MALFORMED_BODY_MESSAGE },
      { status: HTTP_BAD_REQUEST },
    );
  }

  // --- Action validation (no service call on unknown/missing action) -----
  if (!VALID_ACTIONS.includes(action as ValidAction)) {
    return Response.json(
      { error: UNKNOWN_ACTION_MESSAGE },
      { status: HTTP_BAD_REQUEST },
    );
  }

  // --- Field presence validation (no service call on bad shape) ----------
  if (!suggestionId) {
    return Response.json(
      { error: MISSING_SUGGESTION_MESSAGE },
      { status: HTTP_BAD_REQUEST },
    );
  }

  // --- Delegate to service; map rejections to 400 ------------------------
  try {
    if (action === ACTION_USE) {
      if (!draftQuestionId) {
        return Response.json(
          { error: MISSING_DRAFT_QUESTION_MESSAGE },
          { status: HTTP_BAD_REQUEST },
        );
      }
      const questions = await gameService.useSuggestion(
        suggestionId as string,
        draftQuestionId as string,
      );
      return Response.json({ questions }, { status: HTTP_OK });
    }

    await gameService.removeSuggestion(suggestionId as string);
    return Response.json({ ok: true }, { status: HTTP_OK });
  } catch (err) {
    return mapAdminError(err);
  }
}
