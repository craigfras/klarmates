import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Question } from "@/lib/types";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const ADMIN_PLAYER_ID = "player-admin";
const NON_ADMIN_PLAYER_ID = "player-ada";
const QUESTION_ID = "draft-q0";
const ROUTE_URL = "http://localhost/api/admin/week/questions";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;

// Sentinel questions returned by service after an edit/regenerate — asserted
// to be forwarded verbatim in the 200 response.
const UPDATED_QUESTIONS: Question[] = [
  { id: "draft-q0", orderIndex: 0, text: "Edited question text?" },
  { id: "draft-q1", orderIndex: 1, text: "Describe your ideal work style." },
  { id: "draft-q2", orderIndex: 2, text: "What skill do you want to grow?" },
  { id: "draft-q3", orderIndex: 3, text: "Best day at work recently?" },
];

// Raw, unparseable body — deliberately NOT JSON.stringify-ed so request.json()
// throws. Regression for the parse happening outside the try/catch.
const MALFORMED_BODY = "{ this is not valid json";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const getDraftQuestions = vi.fn();
const updateDraftQuestion = vi.fn();
const regenerateQuestion = vi.fn();
const approveWeek = vi.fn();

vi.mock("@/lib/use-cases/getDevActor", () => ({
  getDevActor: vi.fn(async () => ({
    players: [],
    currentPlayerId: ADMIN_PLAYER_ID,
    currentPlayer: { id: ADMIN_PLAYER_ID, isAdmin: true },
  })),
}));

vi.mock("@/lib/services", () => ({
  gameService: {
    getDraftQuestions: (...args: unknown[]) => getDraftQuestions(...args),
    updateDraftQuestion: (...args: unknown[]) => updateDraftQuestion(...args),
    regenerateQuestion: (...args: unknown[]) => regenerateQuestion(...args),
    approveWeek: (...args: unknown[]) => approveWeek(...args),
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
import { POST } from "@/app/api/admin/week/questions/route";
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
  getDraftQuestions.mockReset();
  updateDraftQuestion.mockReset();
  regenerateQuestion.mockReset();
  approveWeek.mockReset();
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(getDevActor).mockReset();

  // Default: admin actor, requireAdmin succeeds, service returns updated list.
  vi.mocked(getDevActor).mockResolvedValue({
    players: [],
    currentPlayerId: ADMIN_PLAYER_ID,
    currentPlayer: { id: ADMIN_PLAYER_ID, isAdmin: true, name: "Admin", email: "admin@getklar.com", active: true },
  });
  vi.mocked(requireAdmin).mockReturnValue({
    id: ADMIN_PLAYER_ID,
    name: "Admin",
    email: "admin@getklar.com",
    isAdmin: true,
    active: true,
  });
  updateDraftQuestion.mockResolvedValue(UPDATED_QUESTIONS);
  regenerateQuestion.mockResolvedValue(UPDATED_QUESTIONS);
});

// ---------------------------------------------------------------------------
// non-admin — 403 + service NOT called
// ---------------------------------------------------------------------------

describe("POST /api/admin/week/questions: non-admin actor", () => {
  beforeEach(() => {
    vi.mocked(getDevActor).mockResolvedValue({
      players: [],
      currentPlayerId: NON_ADMIN_PLAYER_ID,
      currentPlayer: { id: NON_ADMIN_PLAYER_ID, isAdmin: false, name: "Ada", email: "ada@getklar.com", active: true },
    });
    vi.mocked(requireAdmin).mockImplementation(() => {
      throw new ForbiddenError(`Player "${NON_ADMIN_PLAYER_ID}" does not have admin privileges.`);
    });
  });

  it("returns 403 with an error string", async () => {
    const response = await POST(
      postRequest({ action: "edit", questionId: QUESTION_ID, text: "new text" }),
    );

    expect(response.status).toBe(HTTP_FORBIDDEN);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
  });

  it("does NOT call updateDraftQuestion or regenerateQuestion", async () => {
    await POST(
      postRequest({ action: "edit", questionId: QUESTION_ID, text: "new text" }),
    );

    expect(updateDraftQuestion).not.toHaveBeenCalled();
    expect(regenerateQuestion).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// action "edit" — 200 + questions forwarded verbatim
// ---------------------------------------------------------------------------

describe("POST /api/admin/week/questions: action edit", () => {
  it("calls updateDraftQuestion with (questionId, text) and returns 200 with questions", async () => {
    const editedText = "What challenge did you overcome this week?";
    const response = await POST(
      postRequest({ action: "edit", questionId: QUESTION_ID, text: editedText }),
    );

    expect(updateDraftQuestion).toHaveBeenCalledTimes(1);
    expect(updateDraftQuestion).toHaveBeenCalledWith(QUESTION_ID, editedText);
    expect(regenerateQuestion).not.toHaveBeenCalled();

    expect(response.status).toBe(HTTP_OK);
    const json = await response.json();
    expect(json.questions).toEqual(UPDATED_QUESTIONS);
  });
});

// ---------------------------------------------------------------------------
// action "regenerate" — 200 + questions forwarded verbatim
// ---------------------------------------------------------------------------

describe("POST /api/admin/week/questions: action regenerate", () => {
  it("calls regenerateQuestion with questionId and returns 200 with questions", async () => {
    const response = await POST(
      postRequest({ action: "regenerate", questionId: QUESTION_ID }),
    );

    expect(regenerateQuestion).toHaveBeenCalledTimes(1);
    expect(regenerateQuestion).toHaveBeenCalledWith(QUESTION_ID);
    expect(updateDraftQuestion).not.toHaveBeenCalled();

    expect(response.status).toBe(HTTP_OK);
    const json = await response.json();
    expect(json.questions).toEqual(UPDATED_QUESTIONS);
  });
});

// ---------------------------------------------------------------------------
// unknown / invalid action — 400, no service call
// ---------------------------------------------------------------------------

describe("POST /api/admin/week/questions: unknown action", () => {
  it("returns 400 and does not call any service method when action is unrecognised", async () => {
    const response = await POST(
      postRequest({ action: "delete", questionId: QUESTION_ID }),
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(updateDraftQuestion).not.toHaveBeenCalled();
    expect(regenerateQuestion).not.toHaveBeenCalled();
  });

  it("returns 400 when action field is missing", async () => {
    const response = await POST(
      postRequest({ questionId: QUESTION_ID }),
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// service rejection — 400 with thrown message
// ---------------------------------------------------------------------------

describe("POST /api/admin/week/questions: service error", () => {
  it("returns 400 with the error message when updateDraftQuestion rejects", async () => {
    updateDraftQuestion.mockRejectedValue(new Error("Unknown draft question id \"draft-q99\"."));

    const response = await POST(
      postRequest({ action: "edit", questionId: "draft-q99", text: "some text" }),
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(json.error).toBe("Unknown draft question id \"draft-q99\".");
  });

  it("returns 400 with the error message when regenerateQuestion rejects", async () => {
    regenerateQuestion.mockRejectedValue(new Error("Unknown draft question id \"draft-q99\"."));

    const response = await POST(
      postRequest({ action: "regenerate", questionId: "draft-q99" }),
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(json.error).toBe("Unknown draft question id \"draft-q99\".");
  });
});

// ---------------------------------------------------------------------------
// malformed body (regression)
// ---------------------------------------------------------------------------

describe("POST /api/admin/week/questions: malformed body", () => {
  it("returns 400 and does not call any service method when the body is not valid JSON", async () => {
    const response = await POST(
      new Request(ROUTE_URL, { method: "POST", body: MALFORMED_BODY }),
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(updateDraftQuestion).not.toHaveBeenCalled();
    expect(regenerateQuestion).not.toHaveBeenCalled();
  });
});
