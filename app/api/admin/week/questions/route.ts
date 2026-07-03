/**
 * POST /api/admin/week/questions — edit or regenerate a draft question.
 *
 * Orchestrates the HTTP edge only: resolves the dev actor, checks admin
 * privileges, parses and validates the request body, then delegates to
 * gameService. Auth failures → 403; malformed body / unknown action /
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
// Constants
// ---------------------------------------------------------------------------

const ACTION_EDIT = "edit";
const ACTION_REGENERATE = "regenerate";
const VALID_ACTIONS = [ACTION_EDIT, ACTION_REGENERATE] as const;

const MISSING_FIELDS_MESSAGE = "Fields 'action' and 'questionId' are required.";
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
  let questionId: unknown;
  let text: unknown;
  try {
    ({ action, questionId, text } = (await request.json()) as {
      action: unknown;
      questionId: unknown;
      text?: unknown;
    });
  } catch {
    return Response.json(
      { error: MALFORMED_BODY_MESSAGE },
      { status: HTTP_BAD_REQUEST },
    );
  }

  // --- Field presence validation (no service call on bad shape) ----------
  if (!action || !questionId) {
    return Response.json(
      { error: MISSING_FIELDS_MESSAGE },
      { status: HTTP_BAD_REQUEST },
    );
  }

  // --- Action validation (no service call on unknown action) -------------
  if (!VALID_ACTIONS.includes(action as ValidAction)) {
    return Response.json(
      { error: UNKNOWN_ACTION_MESSAGE },
      { status: HTTP_BAD_REQUEST },
    );
  }

  // --- Delegate to service; map rejections to 400 ------------------------
  try {
    let questions;
    if (action === ACTION_EDIT) {
      questions = await gameService.updateDraftQuestion(
        questionId as string,
        text as string,
      );
    } else {
      questions = await gameService.regenerateQuestion(questionId as string);
    }
    return Response.json({ questions }, { status: HTTP_OK });
  } catch (err) {
    return mapAdminError(err);
  }
}
