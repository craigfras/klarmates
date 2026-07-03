import { describe, it, expect, beforeEach, vi } from "vitest";
import type { GuessResult } from "@/lib/types";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const CURRENT_PLAYER_ID = "player-ada";
const WEEK_ID = "week-2026-25";
const QUESTION_ID = "q1";
const CHOSEN_OPTION_ID = "opt-a";
const ROUTE_URL = "http://localhost/api/me/guesses";

// A sentinel result returned verbatim by the route on success.
const SENTINEL_RESULT: GuessResult = {
  questionId: QUESTION_ID,
  correct: true,
  realAnswerText: "The real answer",
};

const VALID_BODY = {
  weekId: WEEK_ID,
  questionId: QUESTION_ID,
  chosenOptionId: CHOSEN_OPTION_ID,
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const submitGuess = vi.fn();

vi.mock("@/lib/use-cases/getDevActor", () => ({
  getDevActor: vi.fn(async () => ({
    players: [],
    currentPlayerId: CURRENT_PLAYER_ID,
    currentPlayer: { id: CURRENT_PLAYER_ID },
  })),
}));

vi.mock("@/lib/services", () => ({
  gameService: {
    submitGuess: (...args: unknown[]) => submitGuess(...args),
  },
}));

// Imported AFTER the mocks are registered.
import { POST } from "@/app/api/me/guesses/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const postRequest = (body: unknown): Request =>
  new Request(ROUTE_URL, {
    method: "POST",
    body: JSON.stringify(body),
  });

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  submitGuess.mockReset();
  submitGuess.mockResolvedValue(SENTINEL_RESULT);
});

// ---------------------------------------------------------------------------
// happy path
// ---------------------------------------------------------------------------

describe("POST /api/me/guesses: success", () => {
  it("calls submitGuess with (playerId, weekId, questionId, chosenOptionId) and returns the result", async () => {
    const response = await POST(postRequest(VALID_BODY));

    expect(submitGuess).toHaveBeenCalledTimes(1);
    expect(submitGuess).toHaveBeenCalledWith(
      CURRENT_PLAYER_ID,
      WEEK_ID,
      QUESTION_ID,
      CHOSEN_OPTION_ID,
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual(SENTINEL_RESULT);
  });
});

// ---------------------------------------------------------------------------
// missing fields → 400
// ---------------------------------------------------------------------------

describe("POST /api/me/guesses: field validation", () => {
  it("returns 400 and does not call submitGuess when weekId is missing", async () => {
    const response = await POST(
      postRequest({ questionId: QUESTION_ID, chosenOptionId: CHOSEN_OPTION_ID }),
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(submitGuess).not.toHaveBeenCalled();
  });

  it("returns 400 and does not call submitGuess when questionId is missing", async () => {
    const response = await POST(
      postRequest({ weekId: WEEK_ID, chosenOptionId: CHOSEN_OPTION_ID }),
    );

    expect(response.status).toBe(400);
    expect(submitGuess).not.toHaveBeenCalled();
  });

  it("returns 400 and does not call submitGuess when chosenOptionId is missing", async () => {
    const response = await POST(
      postRequest({ weekId: WEEK_ID, questionId: QUESTION_ID }),
    );

    expect(response.status).toBe(400);
    expect(submitGuess).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// malformed body (regression)
// ---------------------------------------------------------------------------

// Raw, unparseable body — deliberately NOT JSON.stringify-ed so request.json()
// throws. Must surface as a clean 400, never a 500 / unhandled rejection.
const MALFORMED_BODY = "{ this is not valid json";

describe("POST /api/me/guesses: malformed body", () => {
  it("returns 400 and does not call submitGuess when the body is not valid JSON", async () => {
    const response = await POST(
      new Request(ROUTE_URL, { method: "POST", body: MALFORMED_BODY }),
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(submitGuess).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// service rejection → 400
// ---------------------------------------------------------------------------

describe("POST /api/me/guesses: service error", () => {
  it("returns 400 with the thrown message when submitGuess rejects", async () => {
    submitGuess.mockRejectedValue(
      new Error('Question "q1" has already been guessed.'),
    );

    const response = await POST(postRequest(VALID_BODY));

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe('Question "q1" has already been guessed.');
  });
});
