/**
 * Dev actor resolution.
 *
 * In development there is no auth, so the "current player" is chosen via a
 * cookie holding a player id. The resolver is a pure function — callers inject
 * the live player list so this module has no dependency on any store or fixture.
 */

import type { Player } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cookie name holding the impersonated player's id in development. */
export const DEV_PLAYER_COOKIE = "dev_player_id";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves a cookie value to a valid player id from the injected `players` list.
 * Falls back to `players[0].id` when the value is undefined, empty, or not
 * present in the provided list.
 *
 * Pure function — no imports from store or fixtures; callers supply the list.
 */
export const resolveDevPlayerId = (
  cookieValue: string | undefined,
  players: Player[],
): string => {
  const fallbackId = players[0].id;
  if (!cookieValue) {
    return fallbackId;
  }
  const match = players.find((p) => p.id === cookieValue);
  return match ? match.id : fallbackId;
};
