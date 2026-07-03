/**
 * GET /api/leaderboard — the ranked standings for a scope.
 *
 * Thin HTTP edge: reads the `scope` query, defaults gracefully to "season" when
 * it is missing or invalid (never 400/500), then delegates ranking to
 * `gameService.getLeaderboard`.
 */

import { gameService } from "@/lib/services";
import type { LeaderboardScope } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HTTP_OK = 200;

const SCOPE_PARAM = "scope";
const SEASON_SCOPE: LeaderboardScope = "season";
const ALL_TIME_SCOPE: LeaderboardScope = "all_time";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Coerces the raw query value to a valid scope, defaulting to "season". */
const resolveScope = (raw: string | null): LeaderboardScope =>
  raw === ALL_TIME_SCOPE || raw === SEASON_SCOPE ? raw : SEASON_SCOPE;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  const scope = resolveScope(
    new URL(request.url).searchParams.get(SCOPE_PARAM),
  );

  const ranked = await gameService.getLeaderboard(scope);
  return Response.json(ranked, { status: HTTP_OK });
}
