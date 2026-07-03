import { describe, it, expect, beforeEach, vi } from "vitest";
import { UPCOMING_WEEK_ID } from "@/lib/types";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const ADMIN_PLAYER_ID = "player-admin";
const NON_ADMIN_PLAYER_ID = "player-ada";
const ROUTE_URL = "http://localhost/api/admin/week/approve";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;

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
import { POST } from "@/app/api/admin/week/approve/route";
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

  // Default: admin actor, requireAdmin succeeds, approveWeek resolves.
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
  approveWeek.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// admin — 200 + { ok: true }
// ---------------------------------------------------------------------------

describe("POST /api/admin/week/approve: admin actor", () => {
  it("returns 200 with { ok: true } on success", async () => {
    const response = await POST(postRequest({ weekId: UPCOMING_WEEK_ID }));

    expect(response.status).toBe(HTTP_OK);
    const json = await response.json();
    expect(json.ok).toBe(true);
  });

  it("calls approveWeek exactly once with the provided weekId", async () => {
    await POST(postRequest({ weekId: UPCOMING_WEEK_ID }));

    expect(approveWeek).toHaveBeenCalledTimes(1);
    expect(approveWeek).toHaveBeenCalledWith(UPCOMING_WEEK_ID);
  });

  it("calls requireAdmin with the resolved currentPlayerId", async () => {
    await POST(postRequest({ weekId: UPCOMING_WEEK_ID }));

    expect(requireAdmin).toHaveBeenCalledTimes(1);
    expect(requireAdmin).toHaveBeenCalledWith(ADMIN_PLAYER_ID);
  });
});

// ---------------------------------------------------------------------------
// non-admin — 403 + service NOT called
// ---------------------------------------------------------------------------

describe("POST /api/admin/week/approve: non-admin actor", () => {
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

  it("returns 403 with an error string when requireAdmin throws ForbiddenError", async () => {
    const response = await POST(postRequest({ weekId: UPCOMING_WEEK_ID }));

    expect(response.status).toBe(HTTP_FORBIDDEN);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
  });

  it("does NOT call approveWeek when requireAdmin throws ForbiddenError", async () => {
    await POST(postRequest({ weekId: UPCOMING_WEEK_ID }));

    expect(approveWeek).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// service rejection — 400 with thrown message
// ---------------------------------------------------------------------------

describe("POST /api/admin/week/approve: service error", () => {
  it("returns 400 with the thrown message when approveWeek rejects", async () => {
    approveWeek.mockRejectedValue(new Error("No draft for week \"week-2026-99\"."));

    const response = await POST(postRequest({ weekId: "week-2026-99" }));

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(json.error).toBe("No draft for week \"week-2026-99\".");
  });
});

// ---------------------------------------------------------------------------
// malformed body (regression)
// ---------------------------------------------------------------------------

describe("POST /api/admin/week/approve: malformed body", () => {
  it("returns 400 and does not call approveWeek when the body is not valid JSON", async () => {
    const response = await POST(
      new Request(ROUTE_URL, { method: "POST", body: MALFORMED_BODY }),
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(approveWeek).not.toHaveBeenCalled();
  });
});
