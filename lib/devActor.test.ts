/**
 * Tests for lib/devActor.ts — dev-mode actor helpers.
 *
 * CONTRACT after the store-backed fix:
 *   - `DEV_PLAYER_COOKIE`: exported string constant, non-empty cookie name.
 *   - `resolveDevPlayerId(cookieValue: string | undefined, players: Player[]): string`
 *     PURE function — validates the id against the injected `players` list;
 *     falls back to `players[0].id` when the value is absent, empty, or
 *     not found in the list.
 *   - `listDevPlayers` is REMOVED — no test for it.
 */

import { describe, it, expect } from "vitest";
import { DEV_PLAYER_COOKIE, resolveDevPlayerId } from "@/lib/devActor";
import { players } from "@/lib/fixtures";
import type { Player } from "@/lib/types";

// ---------------------------------------------------------------------------
// Local fixture helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal Player object for use in resolveDevPlayerId tests.
 * Keeps tests self-contained without depending on the full fixture list.
 */
const makePlayer = (id: string, overrides: Partial<Player> = {}): Player => ({
  id,
  name: `Player ${id}`,
  email: `${id}@getklar.com`,
  isAdmin: false,
  active: true,
  ...overrides,
});

/** A small explicit roster used to verify the pure injection contract. */
const SMALL_ROSTER: Player[] = [
  makePlayer("player-alpha"),
  makePlayer("player-beta"),
  makePlayer("player-gamma"),
];

// ---------------------------------------------------------------------------
// DEV_PLAYER_COOKIE
// ---------------------------------------------------------------------------

describe("devActor: DEV_PLAYER_COOKIE", () => {
  it("is a non-empty string cookie name", () => {
    expect(typeof DEV_PLAYER_COOKIE).toBe("string");
    expect(DEV_PLAYER_COOKIE.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// resolveDevPlayerId — new pure signature: (cookieValue, players) => string
// ---------------------------------------------------------------------------
// These cases will FAIL until the implementation adopts the new signature.
// The old signature is resolveDevPlayerId(cookieValue: string | undefined)
// with no second parameter; passing the player list was not possible.

describe("devActor: resolveDevPlayerId — injected player list (new pure signature)", () => {
  it("returns the cookie value when it is a valid id in the injected list", () => {
    const validId = SMALL_ROSTER[SMALL_ROSTER.length - 1].id;
    expect(resolveDevPlayerId(validId, SMALL_ROSTER)).toBe(validId);
  });

  it("returns the first player id when the cookie is undefined", () => {
    expect(resolveDevPlayerId(undefined, SMALL_ROSTER)).toBe(SMALL_ROSTER[0].id);
  });

  it("returns the first player id for an unknown/garbage id", () => {
    expect(resolveDevPlayerId("not-a-real-id", SMALL_ROSTER)).toBe(
      SMALL_ROSTER[0].id,
    );
  });

  it("returns the first player id for an empty string", () => {
    expect(resolveDevPlayerId("", SMALL_ROSTER)).toBe(SMALL_ROSTER[0].id);
  });

  it("resolves the middle item in the injected list correctly", () => {
    const middleId = SMALL_ROSTER[1].id;
    expect(resolveDevPlayerId(middleId, SMALL_ROSTER)).toBe(middleId);
  });

  it("uses the fixture players array when passed as the injected list", () => {
    // Ensures the function works with the real fixture data as the list source.
    const lastFixturePlayer = players[players.length - 1];
    expect(resolveDevPlayerId(lastFixturePlayer.id, players)).toBe(
      lastFixturePlayer.id,
    );
  });

  it("falls back to players[0].id when the id is in a DIFFERENT list (not the injected one)", () => {
    // player-ada is in fixtures but NOT in SMALL_ROSTER → should fall back.
    expect(resolveDevPlayerId("player-ada", SMALL_ROSTER)).toBe(
      SMALL_ROSTER[0].id,
    );
  });
});
