import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// next/headers cookie mock — unchanged from original.
const get = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ get }) }));

// Replace getMockStore with a mock of @/lib/services so that getDevActor
// reads from the SELECTED backend (DB or mock) rather than the in-memory store.
const listRoster = vi.fn<() => Promise<import("@/lib/types").Player[]>>();
vi.mock("@/lib/services", () => ({
  gameService: { listRoster },
}));

import { getDevActor } from "@/lib/use-cases/getDevActor";
import { DEV_PLAYER_COOKIE } from "@/lib/devActor";
import type { Player } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

/** HTTP 403 Forbidden status code — not used here but kept to satisfy rule. */

/** Index of a service-roster player that is NOT the first. */
const NON_FIRST_INDEX = 1;

// ---------------------------------------------------------------------------
// Fixture: a DB-style uuid roster (not fixture ids like "player-ada")
// This exercises the real contract: getDevActor must reflect whatever the
// selected backend's listRoster() returns, which in DB mode has uuid ids.
// ---------------------------------------------------------------------------

const DB_ROSTER: Player[] = [
  { id: "uuid-1", name: "Craig F",   email: "craig@example.com",  isAdmin: true,  active: true },
  { id: "uuid-2", name: "Dana K",    email: "dana@example.com",   isAdmin: false, active: true },
  { id: "uuid-3", name: "Jordan M",  email: "jordan@example.com", isAdmin: false, active: true },
];

// ---------------------------------------------------------------------------
// Tests — getDevActor sources roster from gameService.listRoster()
// ---------------------------------------------------------------------------

describe("getDevActor — sources roster from gameService.listRoster()", () => {
  beforeEach(() => {
    get.mockReset();
    listRoster.mockReset();
    listRoster.mockResolvedValue(DB_ROSTER);
  });

  // Happy path: cookie contains a valid uuid that exists in the service roster.
  it("resolves a valid cookie player id to the matching service-roster player", async () => {
    const target = DB_ROSTER[NON_FIRST_INDEX]; // "uuid-2" — not the fallback
    get.mockImplementation((name: string) =>
      name === DEV_PLAYER_COOKIE ? { value: target.id } : undefined,
    );

    const actor = await getDevActor();

    // currentPlayerId must come from listRoster's return, not getMockStore.
    expect(actor.currentPlayerId).toBe(target.id);
    // currentPlayer must be the full Player object from the service roster.
    expect(actor.currentPlayer).toEqual(target);
    // players must equal exactly what listRoster resolved with.
    expect(actor.players).toEqual(DB_ROSTER);
  });

  // Edge case: cookie carries a uuid from the service roster that happens to be
  // the first player (ensure the result is still that player, not some fallback).
  it("resolves the first service-roster player when the cookie targets it explicitly", async () => {
    const target = DB_ROSTER[0];
    get.mockImplementation((name: string) =>
      name === DEV_PLAYER_COOKIE ? { value: target.id } : undefined,
    );

    const actor = await getDevActor();

    expect(actor.currentPlayerId).toBe(target.id);
    expect(actor.currentPlayer).toEqual(target);
  });

  // Edge case: cookie absent → falls back to first player from the service roster
  // (not from getMockStore — so in DB mode this is the first DB record).
  it("falls back to the first service-roster player when the cookie is absent", async () => {
    get.mockReturnValue(undefined);

    const actor = await getDevActor();

    expect(actor.currentPlayerId).toBe(DB_ROSTER[0].id);
    expect(actor.currentPlayer).toEqual(DB_ROSTER[0]);
    expect(actor.players).toEqual(DB_ROSTER);
  });

  // Edge case: cookie contains an id that does NOT exist in the service roster
  // (e.g. a stale cookie after a DB migration) → falls back to first player.
  it("falls back to the first service-roster player when the cookie id is unknown", async () => {
    get.mockImplementation((name: string) =>
      name === DEV_PLAYER_COOKIE ? { value: "stale-fixture-id-that-no-longer-exists" } : undefined,
    );

    const actor = await getDevActor();

    expect(actor.currentPlayerId).toBe(DB_ROSTER[0].id);
    expect(actor.currentPlayer).toEqual(DB_ROSTER[0]);
  });

  // Contract: listRoster must be called exactly once per getDevActor() call.
  it("calls gameService.listRoster() exactly once", async () => {
    get.mockReturnValue(undefined);

    await getDevActor();

    expect(listRoster).toHaveBeenCalledTimes(1);
  });

  // Contract: the returned `players` array equals the listRoster resolution
  // even when a non-first player is the current actor. This proves the full
  // roster is passed through, not filtered.
  it("returns the full service roster in the players field regardless of who is current", async () => {
    const target = DB_ROSTER[NON_FIRST_INDEX];
    get.mockImplementation((name: string) =>
      name === DEV_PLAYER_COOKIE ? { value: target.id } : undefined,
    );

    const actor = await getDevActor();

    expect(actor.players).toHaveLength(DB_ROSTER.length);
    expect(actor.players).toEqual(DB_ROSTER);
  });
});
