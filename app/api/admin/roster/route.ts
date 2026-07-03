/**
 * GET + POST /api/admin/roster — list and manage the player roster.
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
import type { Player } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTION_UPSERT = "upsert";
const ACTION_DEACTIVATE = "deactivate";
const ACTION_RESOLVE_SLACK = "resolve_slack";
const VALID_ACTIONS = [
  ACTION_UPSERT,
  ACTION_DEACTIVATE,
  ACTION_RESOLVE_SLACK,
] as const;

const UNKNOWN_ACTION_MESSAGE = `Action must be one of: ${VALID_ACTIONS.join(", ")}.`;

type ValidAction = (typeof VALID_ACTIONS)[number];

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(_request: Request): Promise<Response> {
  // --- Authorization: admin-only endpoint ---------------------------------
  const authResult = await requireAdminActor();
  if (!authResult.ok) {
    return authResult.response;
  }

  // --- Delegate to service; map rejections to 400 -------------------------
  try {
    const players = await gameService.listRoster();
    return Response.json({ players }, { status: HTTP_OK });
  } catch (err) {
    return mapAdminError(err);
  }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  // --- Authorization: admin-only endpoint ---------------------------------
  const authResult = await requireAdminActor();
  if (!authResult.ok) {
    return authResult.response;
  }

  // --- Safe body parse (malformed JSON → 400, no service call) -----------
  let action: unknown;
  let player: unknown;
  let playerId: unknown;
  try {
    ({ action, player, playerId } = (await request.json()) as {
      action: unknown;
      player?: unknown;
      playerId?: unknown;
    });
  } catch {
    return Response.json(
      { error: MALFORMED_BODY_MESSAGE },
      { status: HTTP_BAD_REQUEST },
    );
  }

  // --- Action validation (no service call on unknown or missing action) ---
  if (!action || !VALID_ACTIONS.includes(action as ValidAction)) {
    return Response.json(
      { error: UNKNOWN_ACTION_MESSAGE },
      { status: HTTP_BAD_REQUEST },
    );
  }

  // --- Delegate to service; map rejections to 400 ------------------------
  try {
    let players: Player[];
    if (action === ACTION_UPSERT) {
      players = await gameService.upsertPlayer(player as Player);
    } else if (action === ACTION_DEACTIVATE) {
      players = await gameService.deactivatePlayer(playerId as string);
    } else {
      // resolve_slack: backfill missing Slack ids, then return the refreshed roster.
      await gameService.backfillSlackIds();
      players = await gameService.listRoster();
    }
    return Response.json({ players }, { status: HTTP_OK });
  } catch (err) {
    return mapAdminError(err);
  }
}
