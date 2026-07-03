/**
 * POST /api/admin/suggestions route tests
 * (question-suggestions slices 3 & 4 — admin use / discard actions).
 *
 * Mirrors app/api/admin/week/questions/route.test.ts exactly for the mock
 * setup (getDevActor, gameService with useSuggestion/removeSuggestion vi.fns,
 * authz requireAdmin + ForbiddenError).
 *
 * Contract:
 *   - Guarded by requireAdmin(); non-admin → 403 and NEITHER service method
 *     is called.
 *   - Body: { action: "use" | "remove", suggestionId: string,
 *             draftQuestionId?: string }.
 *   - action "use" (+ draftQuestionId) → useSuggestion(suggestionId,
 *     draftQuestionId), 200 { questions } (service array forwarded verbatim).
 *   - action "use" missing draftQuestionId → 400, useSuggestion NOT called.
 *   - action "remove" → removeSuggestion(suggestionId), 200 { ok: true }.
 *   - missing suggestionId (either action) → 400, no service call.
 *   - unknown action → 400, no service call.
 *   - malformed JSON body → 400, no service call.
 *   - service rejection → 400 with the thrown message (mapAdminError pattern).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Question } from "@/lib/types";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const ADMIN_PLAYER_ID = "player-admin";
const NON_ADMIN_PLAYER_ID = "player-ada";
const SUGGESTION_ID = "sug-1";
const DRAFT_QUESTION_ID = "draft-q1";
const ROUTE_URL = "http://localhost/api/admin/suggestions";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;

// Sentinel questions returned by useSuggestion — asserted to be forwarded
// verbatim in the 200 response.
const UPDATED_QUESTIONS: Question[] = [
  { id: "draft-q0", orderIndex: 0, text: "Draft question 0 text?" },
  { id: "draft-q1", orderIndex: 1, text: "The used suggestion text?" },
  { id: "draft-q2", orderIndex: 2, text: "Draft question 2 text?" },
  { id: "draft-q3", orderIndex: 3, text: "Draft question 3 text?" },
];

// Raw, unparseable body — deliberately NOT JSON.stringify-ed so request.json()
// throws.
const MALFORMED_BODY = "{ this is not valid json";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const useSuggestion = vi.fn();
const removeSuggestion = vi.fn();

vi.mock("@/lib/use-cases/getDevActor", () => ({
  getDevActor: vi.fn(async () => ({
    players: [],
    currentPlayerId: ADMIN_PLAYER_ID,
    currentPlayer: { id: ADMIN_PLAYER_ID, isAdmin: true },
  })),
}));

vi.mock("@/lib/services", () => ({
  gameService: {
    useSuggestion: (...args: unknown[]) => useSuggestion(...args),
    removeSuggestion: (...args: unknown[]) => removeSuggestion(...args),
  },
}));

vi.mock("@/lib/authz", () => ({
  requireAdmin: vi.fn(),
  ForbiddenError: class ForbiddenError extends Error {
    readonly status = 403;
    constructor(message: string) {
      super(message);
      this.name = "ForbiddenError";
    }
  },
}));

// Imported AFTER the mocks are registered.
import { POST } from "@/app/api/admin/suggestions/route";
import { getDevActor } from "@/lib/use-cases/getDevActor";
import { requireAdmin, ForbiddenError } from "@/lib/authz";

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
  useSuggestion.mockReset();
  removeSuggestion.mockReset();
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(getDevActor).mockReset();

  // Default: admin actor, requireAdmin succeeds, service returns updated list.
  vi.mocked(getDevActor).mockResolvedValue({
    players: [],
    currentPlayerId: ADMIN_PLAYER_ID,
    currentPlayer: {
      id: ADMIN_PLAYER_ID,
      isAdmin: true,
      name: "Admin",
      email: "admin@getklar.com",
      active: true,
    },
  });
  vi.mocked(requireAdmin).mockReturnValue({
    id: ADMIN_PLAYER_ID,
    name: "Admin",
    email: "admin@getklar.com",
    isAdmin: true,
    active: true,
  });
  useSuggestion.mockResolvedValue(UPDATED_QUESTIONS);
  removeSuggestion.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// non-admin — 403 + no service call
// ---------------------------------------------------------------------------

describe("POST /api/admin/suggestions: non-admin actor", () => {
  beforeEach(() => {
    vi.mocked(getDevActor).mockResolvedValue({
      players: [],
      currentPlayerId: NON_ADMIN_PLAYER_ID,
      currentPlayer: {
        id: NON_ADMIN_PLAYER_ID,
        isAdmin: false,
        name: "Ada",
        email: "ada@getklar.com",
        active: true,
      },
    });
    vi.mocked(requireAdmin).mockImplementation(() => {
      throw new ForbiddenError(
        `Player "${NON_ADMIN_PLAYER_ID}" does not have admin privileges.`,
      );
    });
  });

  it("returns 403 with an error string", async () => {
    const response = await POST(
      postRequest({ action: "use", suggestionId: SUGGESTION_ID, draftQuestionId: DRAFT_QUESTION_ID }),
    );

    expect(response.status).toBe(HTTP_FORBIDDEN);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
  });

  it("does NOT call useSuggestion or removeSuggestion", async () => {
    await POST(
      postRequest({ action: "use", suggestionId: SUGGESTION_ID, draftQuestionId: DRAFT_QUESTION_ID }),
    );

    expect(useSuggestion).not.toHaveBeenCalled();
    expect(removeSuggestion).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// action "use" — 200 + questions forwarded verbatim
// ---------------------------------------------------------------------------

describe("POST /api/admin/suggestions: action use", () => {
  it("calls useSuggestion with (suggestionId, draftQuestionId) and returns 200 with questions", async () => {
    const response = await POST(
      postRequest({
        action: "use",
        suggestionId: SUGGESTION_ID,
        draftQuestionId: DRAFT_QUESTION_ID,
      }),
    );

    expect(useSuggestion).toHaveBeenCalledTimes(1);
    expect(useSuggestion).toHaveBeenCalledWith(SUGGESTION_ID, DRAFT_QUESTION_ID);
    expect(removeSuggestion).not.toHaveBeenCalled();

    expect(response.status).toBe(HTTP_OK);
    const json = await response.json();
    expect(json.questions).toEqual(UPDATED_QUESTIONS);
  });

  it("returns 400 and does not call useSuggestion when draftQuestionId is missing", async () => {
    const response = await POST(
      postRequest({ action: "use", suggestionId: SUGGESTION_ID }),
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(useSuggestion).not.toHaveBeenCalled();
  });

  it("returns 400 and does not call useSuggestion when suggestionId is missing", async () => {
    const response = await POST(
      postRequest({ action: "use", draftQuestionId: DRAFT_QUESTION_ID }),
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(useSuggestion).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// action "remove" — 200 + { ok: true }
// ---------------------------------------------------------------------------

describe("POST /api/admin/suggestions: action remove", () => {
  it("calls removeSuggestion with suggestionId and returns 200 with { ok: true }", async () => {
    const response = await POST(
      postRequest({ action: "remove", suggestionId: SUGGESTION_ID }),
    );

    expect(removeSuggestion).toHaveBeenCalledTimes(1);
    expect(removeSuggestion).toHaveBeenCalledWith(SUGGESTION_ID);
    expect(useSuggestion).not.toHaveBeenCalled();

    expect(response.status).toBe(HTTP_OK);
    const json = await response.json();
    expect(json.ok).toBe(true);
  });

  it("returns 400 and does not call removeSuggestion when suggestionId is missing", async () => {
    const response = await POST(postRequest({ action: "remove" }));

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(removeSuggestion).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// unknown action — 400, no service call
// ---------------------------------------------------------------------------

describe("POST /api/admin/suggestions: unknown action", () => {
  it("returns 400 and calls no service method when action is unrecognised", async () => {
    const response = await POST(
      postRequest({ action: "delete", suggestionId: SUGGESTION_ID }),
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(useSuggestion).not.toHaveBeenCalled();
    expect(removeSuggestion).not.toHaveBeenCalled();
  });

  it("returns 400 when the action field is missing", async () => {
    const response = await POST(postRequest({ suggestionId: SUGGESTION_ID }));

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(useSuggestion).not.toHaveBeenCalled();
    expect(removeSuggestion).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// malformed body — 400, no service call
// ---------------------------------------------------------------------------

describe("POST /api/admin/suggestions: malformed body", () => {
  it("returns 400 and calls no service method when the body is not valid JSON", async () => {
    const response = await POST(
      new Request(ROUTE_URL, { method: "POST", body: MALFORMED_BODY }),
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(useSuggestion).not.toHaveBeenCalled();
    expect(removeSuggestion).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// service rejection — 400 with the thrown message (mapAdminError)
// ---------------------------------------------------------------------------

describe("POST /api/admin/suggestions: service error", () => {
  it("returns 400 with the error message when useSuggestion rejects", async () => {
    useSuggestion.mockRejectedValue(
      new Error('Unknown suggestion id "sug-nope".'),
    );

    const response = await POST(
      postRequest({
        action: "use",
        suggestionId: "sug-nope",
        draftQuestionId: DRAFT_QUESTION_ID,
      }),
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(json.error).toBe('Unknown suggestion id "sug-nope".');
  });

  it("returns 400 with the error message when removeSuggestion rejects", async () => {
    removeSuggestion.mockRejectedValue(
      new Error('Unknown suggestion id "sug-nope".'),
    );

    const response = await POST(
      postRequest({ action: "remove", suggestionId: "sug-nope" }),
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(json.error).toBe('Unknown suggestion id "sug-nope".');
  });
});
