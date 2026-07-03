import { describe, it, expect, beforeEach, vi } from "vitest";
import type { GuessSheet, MyWeekView } from "@/lib/types";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const CURRENT_PLAYER_ID = "player-ada";
const WEEK_ID = "week-2026-25";
const ROUTE_URL = "http://localhost/api/me/guess";

// A view supplying the weekId the route forwards into getGuessSheet.
const SENTINEL_VIEW: MyWeekView = {
  weekId: WEEK_ID,
  startsAt: "2026-06-22T00:00:00.000Z",
  status: "open",
  opponent: null,
  isBye: false,
  questions: [],
  myAnswersSubmitted: true,
  opponentAnswered: true,
  guessingUnlocked: true,
  guessingComplete: false,
  myCorrectGuesses: 0,
};

// A sentinel guess sheet returned verbatim by the route on success.
const SENTINEL_SHEET: GuessSheet = [
  {
    questionId: "q1",
    questionText: "Question one?",
    options: [
      { id: "opt-a", text: "Alpha" },
      { id: "opt-b", text: "Beta" },
    ],
    result: null,
  },
];

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const getMyWeek = vi.fn();
const getGuessSheet = vi.fn();

vi.mock("@/lib/use-cases/getDevActor", () => ({
  getDevActor: vi.fn(async () => ({
    players: [],
    currentPlayerId: CURRENT_PLAYER_ID,
    currentPlayer: { id: CURRENT_PLAYER_ID },
  })),
}));

vi.mock("@/lib/services", () => ({
  gameService: {
    getMyWeek: (...args: unknown[]) => getMyWeek(...args),
    getGuessSheet: (...args: unknown[]) => getGuessSheet(...args),
  },
}));

// Imported AFTER the mocks are registered.
import { GET } from "@/app/api/me/guess/route";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  getMyWeek.mockReset();
  getGuessSheet.mockReset();
  getMyWeek.mockResolvedValue(SENTINEL_VIEW);
  getGuessSheet.mockResolvedValue(SENTINEL_SHEET);
});

const getRequest = (): Request =>
  new Request(ROUTE_URL, { method: "GET" });

// ---------------------------------------------------------------------------
// happy path
// ---------------------------------------------------------------------------

describe("GET /api/me/guess: success", () => {
  it("returns 200 with the guess sheet when guessing is unlocked", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual(SENTINEL_SHEET);
  });

  it("resolves the week via getMyWeek and calls getGuessSheet with (playerId, weekId)", async () => {
    await GET(getRequest());

    expect(getMyWeek).toHaveBeenCalledWith(CURRENT_PLAYER_ID);
    expect(getGuessSheet).toHaveBeenCalledWith(CURRENT_PLAYER_ID, WEEK_ID);
  });
});

// ---------------------------------------------------------------------------
// not unlocked → 403
// ---------------------------------------------------------------------------

describe("GET /api/me/guess: not unlocked", () => {
  it("returns 403 with an error when getGuessSheet throws", async () => {
    getGuessSheet.mockRejectedValue(
      new Error('Guessing is not unlocked for player "player-ada".'),
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
  });
});
