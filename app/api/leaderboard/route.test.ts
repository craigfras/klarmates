import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RankedRow } from "@/lib/scoring";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const ROUTE_URL = "http://localhost/api/leaderboard";

// A sentinel ranked board returned verbatim by the route on success.
const SENTINEL_BOARD: RankedRow[] = [
  { playerId: "player-ada", name: "Ada Lovelace", total: 5, correctGuesses: 4, rank: 1 },
  { playerId: "player-linus", name: "Linus Bytes", total: 5, correctGuesses: 3, rank: 2 },
];

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const getLeaderboard = vi.fn();

vi.mock("@/lib/services", () => ({
  gameService: {
    getLeaderboard: (...args: unknown[]) => getLeaderboard(...args),
  },
}));

// Imported AFTER the mocks are registered.
import { GET } from "@/app/api/leaderboard/route";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  getLeaderboard.mockReset();
  getLeaderboard.mockResolvedValue(SENTINEL_BOARD);
});

const getRequest = (query = ""): Request =>
  new Request(`${ROUTE_URL}${query}`);

// ---------------------------------------------------------------------------
// happy path
// ---------------------------------------------------------------------------

describe("GET /api/leaderboard: success", () => {
  it("returns 200 with the ranked rows from getLeaderboard", async () => {
    const response = await GET(getRequest("?scope=season"));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual(SENTINEL_BOARD);
  });
});

// ---------------------------------------------------------------------------
// scope forwarding
// ---------------------------------------------------------------------------

describe("GET /api/leaderboard: scope forwarding", () => {
  it("forwards 'all_time' when ?scope=all_time", async () => {
    await GET(getRequest("?scope=all_time"));

    expect(getLeaderboard).toHaveBeenCalledWith("all_time");
  });

  it("forwards 'season' when ?scope=season", async () => {
    await GET(getRequest("?scope=season"));

    expect(getLeaderboard).toHaveBeenCalledWith("season");
  });

  it("defaults to 'season' when the scope is missing", async () => {
    await GET(getRequest(""));

    expect(getLeaderboard).toHaveBeenCalledWith("season");
  });

  it("defaults to 'season' when the scope is invalid (no 500/400)", async () => {
    const response = await GET(getRequest("?scope=banana"));

    expect(response.status).toBe(200);
    expect(getLeaderboard).toHaveBeenCalledWith("season");
  });
});
