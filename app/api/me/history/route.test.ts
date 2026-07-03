import { describe, it, expect, beforeEach, vi } from "vitest";
import type { HistoryEntry } from "@/lib/types";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const CURRENT_PLAYER_ID = "player-ada";
const ROUTE_URL = "http://localhost/api/me/history";

// A sentinel history list returned verbatim by the route on success.
const SENTINEL_HISTORY: HistoryEntry[] = [
  {
    weekId: "week-2026-24",
    startsAt: "2026-06-08T00:00:00.000Z",
    opponentName: "Grace Hopper",
    recap: { meCorrect: 3, opponentCorrect: 2, questionCount: 4 },
  },
];

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const getMyHistory = vi.fn();

vi.mock("@/lib/use-cases/getDevActor", () => ({
  getDevActor: vi.fn(async () => ({
    players: [],
    currentPlayerId: CURRENT_PLAYER_ID,
    currentPlayer: { id: CURRENT_PLAYER_ID },
  })),
}));

vi.mock("@/lib/services", () => ({
  gameService: {
    getMyHistory: (...args: unknown[]) => getMyHistory(...args),
  },
}));

// Imported AFTER the mocks are registered.
import { GET } from "@/app/api/me/history/route";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  getMyHistory.mockReset();
  getMyHistory.mockResolvedValue(SENTINEL_HISTORY);
});

const getRequest = (): Request => new Request(ROUTE_URL, { method: "GET" });

// ---------------------------------------------------------------------------
// happy path
// ---------------------------------------------------------------------------

describe("GET /api/me/history: success", () => {
  it("resolves the actor and returns getMyHistory(playerId)", async () => {
    const response = await GET(getRequest());

    expect(getMyHistory).toHaveBeenCalledWith(CURRENT_PLAYER_ID);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual(SENTINEL_HISTORY);
  });

  it("returns 200 with an empty list when the player has no history", async () => {
    getMyHistory.mockResolvedValue([]);

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual([]);
  });
});
