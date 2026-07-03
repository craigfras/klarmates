import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AnswerSubmission, MyWeekView } from "@/lib/types";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const CURRENT_PLAYER_ID = "player-ada";
const WEEK_ID = "week-2026-25";
const ROUTE_URL = "http://localhost/api/me/answers";

// A sentinel view returned by the mocked getMyWeek so we can assert the route
// forwards it verbatim.
const SENTINEL_VIEW: MyWeekView = {
  weekId: WEEK_ID,
  startsAt: "2026-06-22T00:00:00.000Z",
  status: "open",
  opponent: null,
  isBye: false,
  questions: [],
  myAnswersSubmitted: true,
  opponentAnswered: false,
  guessingUnlocked: false,
  guessingComplete: false,
  myCorrectGuesses: 0,
};

// Exactly WEEKLY_QUESTION_COUNT (4) answers.
const VALID_ANSWERS: AnswerSubmission[] = [
  { questionId: "q1", text: "one" },
  { questionId: "q2", text: "two" },
  { questionId: "q3", text: "three" },
  { questionId: "q4", text: "four" },
];

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const submitAnswers = vi.fn();
const getMyWeek = vi.fn();
const ensureAnswerOptions = vi.fn();

vi.mock("@/lib/use-cases/getDevActor", () => ({
  getDevActor: vi.fn(async () => ({
    players: [],
    currentPlayerId: CURRENT_PLAYER_ID,
    currentPlayer: { id: CURRENT_PLAYER_ID },
  })),
}));

vi.mock("@/lib/services", () => ({
  gameService: {
    submitAnswers: (...args: unknown[]) => submitAnswers(...args),
    getMyWeek: (...args: unknown[]) => getMyWeek(...args),
    ensureAnswerOptions: (...args: unknown[]) => ensureAnswerOptions(...args),
  },
}));

// Run the scheduled background callback synchronously so we can observe it.
// The returned promise is intentionally ignored (swallowed) — mirroring
// fire-and-forget, so a rejecting callback must never surface to the response.
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    void cb();
  },
}));

// Imported AFTER the mocks are registered.
import { POST } from "@/app/api/me/answers/route";

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
  submitAnswers.mockReset();
  getMyWeek.mockReset();
  ensureAnswerOptions.mockReset();
  submitAnswers.mockResolvedValue(undefined);
  getMyWeek.mockResolvedValue(SENTINEL_VIEW);
  ensureAnswerOptions.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// invalid answer count
// ---------------------------------------------------------------------------

describe("POST /api/me/answers: count validation", () => {
  it("returns 400 and does not call submitAnswers when answers is not an array", async () => {
    const response = await POST(
      postRequest({ weekId: WEEK_ID, answers: "nope" }),
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(submitAnswers).not.toHaveBeenCalled();
  });

  it("returns 400 and does not call submitAnswers when the count is wrong", async () => {
    const response = await POST(
      postRequest({
        weekId: WEEK_ID,
        answers: [{ questionId: "q1", text: "one" }],
      }),
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(submitAnswers).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// happy path
// ---------------------------------------------------------------------------

describe("POST /api/me/answers: success", () => {
  it("calls submitAnswers with (playerId, weekId, answers) and returns the view", async () => {
    const response = await POST(
      postRequest({ weekId: WEEK_ID, answers: VALID_ANSWERS }),
    );

    expect(submitAnswers).toHaveBeenCalledTimes(1);
    expect(submitAnswers).toHaveBeenCalledWith(
      CURRENT_PLAYER_ID,
      WEEK_ID,
      VALID_ANSWERS,
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual(SENTINEL_VIEW);
  });
});

// ---------------------------------------------------------------------------
// background option generation (scheduled via after)
// ---------------------------------------------------------------------------

describe("POST /api/me/answers: background option generation", () => {
  it("schedules ensureAnswerOptions(currentPlayerId, weekId) exactly once and still returns 200 with the view", async () => {
    const response = await POST(
      postRequest({ weekId: WEEK_ID, answers: VALID_ANSWERS }),
    );

    expect(ensureAnswerOptions).toHaveBeenCalledTimes(1);
    expect(ensureAnswerOptions).toHaveBeenCalledWith(CURRENT_PLAYER_ID, WEEK_ID);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual(SENTINEL_VIEW);
  });

  it("returns 200 with the view even when the background ensureAnswerOptions rejects", async () => {
    ensureAnswerOptions.mockRejectedValue(new Error("generation blew up"));

    const response = await POST(
      postRequest({ weekId: WEEK_ID, answers: VALID_ANSWERS }),
    );

    // The fire-and-forget failure must NOT surface into the response.
    expect(ensureAnswerOptions).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual(SENTINEL_VIEW);
  });
});

// ---------------------------------------------------------------------------
// service rejection
// ---------------------------------------------------------------------------

describe("POST /api/me/answers: service error", () => {
  it("returns 400 with the thrown message when submitAnswers rejects", async () => {
    submitAnswers.mockRejectedValue(new Error("already submitted"));

    const response = await POST(
      postRequest({ weekId: WEEK_ID, answers: VALID_ANSWERS }),
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("already submitted");
  });
});

// ---------------------------------------------------------------------------
// malformed body (regression)
// ---------------------------------------------------------------------------

// Raw, unparseable body — deliberately NOT JSON.stringify-ed so request.json()
// throws. Regression for the parse happening outside the try/catch, which
// surfaced as a 500 / unhandled rejection instead of a clean 400.
const MALFORMED_BODY = "{ this is not valid json";

describe("POST /api/me/answers: malformed body", () => {
  it("returns 400 and does not call submitAnswers when the body is not valid JSON", async () => {
    const response = await POST(
      new Request(ROUTE_URL, { method: "POST", body: MALFORMED_BODY }),
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(submitAnswers).not.toHaveBeenCalled();
  });
});
