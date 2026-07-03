/**
 * Resolve the "current player" for a request.
 *
 * Until real auth lands (Google SSO, a later slice), the active player is chosen
 * via a dev cookie. This use-case is the single server-side seam that reads that
 * cookie and resolves it to a concrete roster player.
 *
 * Players are sourced from `gameService.listRoster()` so that in DB mode the
 * real database roster is used, and in mock mode the in-memory store is used.
 * This ensures both modes work correctly regardless of which backend is selected.
 *
 * The service module is imported dynamically inside the function so that test
 * mocks registered via `vi.mock("@/lib/services", factory)` are resolved after
 * the test file's top-level declarations have run, avoiding temporal dead zone
 * errors when the mock factory references a `vi.fn()` variable.
 */

import { cookies } from "next/headers";
import { DEV_PLAYER_COOKIE, resolveDevPlayerId } from "@/lib/devActor";
import type { Player } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DevActor = {
  players: Player[];
  currentPlayerId: string;
  currentPlayer: Player;
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export async function getDevActor(): Promise<DevActor> {
  // Dynamic import defers module resolution to call-time so that vi.mock()
  // factories are evaluated after test top-level declarations are initialised.
  const { gameService } = await import("@/lib/services");

  // Source the live roster from the selected backend service so that in DB mode
  // the real database roster is used rather than in-memory fixture ids.
  const players = await gameService.listRoster();

  // --- Production: identity comes from the real Google session ------------
  // (slice 10). The dev-actor cookie path below is local-dev only.
  if (process.env.NODE_ENV === "production") {
    const { getCurrentPlayer } = await import("@/lib/auth");
    const currentPlayer = await getCurrentPlayer();
    // DENY rather than impersonate when there's no valid session. Middleware
    // redirects unauthenticated requests before they reach here; this throw is
    // the defense-in-depth backstop (never silently act as another player).
    if (!currentPlayer) {
      throw new Error("Not authenticated.");
    }
    return { players, currentPlayerId: currentPlayer.id, currentPlayer };
  }

  // --- Local dev: impersonate via the dev-actor cookie -------------------
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(DEV_PLAYER_COOKIE)?.value;
  const currentPlayerId = resolveDevPlayerId(cookieValue, players);
  const currentPlayer = players.find((p) => p.id === currentPlayerId) ?? players[0];

  return { players, currentPlayerId, currentPlayer };
}
