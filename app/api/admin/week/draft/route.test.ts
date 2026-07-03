import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Question } from "@/lib/types";
import { UPCOMING_WEEK_ID } from "@/lib/types";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const ADMIN_PLAYER_ID = "player-admin";
const NON_ADMIN_PLAYER_ID = "player-ada";
const ROUTE_URL = "http://localhost/api/admin/week/draft";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;

// Sentinel questions returned by the mocked getDraftQuestions — asserted to
// flow through verbatim in the 200 response.
const SENTINEL_QUESTIONS: Question[] = [
  { id: "draft-q0", orderIndex: 0, text: "What motivates you most?" },
  { id: "draft-q1", orderIndex: 1, text: "Describe your ideal work style." },
  { id: "draft-q2", orderIndex: 2, text: "What skill do you want to grow?" },
  { id: "draft-q3", orderIndex: 3, text: "Best day at work recently?" },
];

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// vi.fn() stubs for the four admin service methods — the whole mock module
// references these so each test can set expectations per-call.
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

// Mock requireAdmin so it can be made to either succeed or throw ForbiddenError
// without depending on real fixture data.
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
import { GET } from "@/app/api/admin/week/draft/route";
import { getDevActor } from "@/lib/use-cases/getDevActor";
import { requireAdmin, ForbiddenError } from "@/lib/authz";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getRequest = (): Request => new Request(ROUTE_URL, { method: "GET" });

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

  // Default: admin actor, requireAdmin succeeds.
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
  getDraftQuestions.mockResolvedValue(SENTINEL_QUESTIONS);
});

// ---------------------------------------------------------------------------
// admin — 200 + payload forwarded verbatim
// ---------------------------------------------------------------------------

describe("GET /api/admin/week/draft: admin actor", () => {
  it("returns 200 with weekId and questions when requireAdmin succeeds", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(HTTP_OK);
    const json = await response.json();
    expect(json.weekId).toBe(UPCOMING_WEEK_ID);
    expect(json.questions).toEqual(SENTINEL_QUESTIONS);
  });

  it("calls getDraftQuestions exactly once with UPCOMING_WEEK_ID", async () => {
    await GET(getRequest());

    expect(getDraftQuestions).toHaveBeenCalledTimes(1);
    expect(getDraftQuestions).toHaveBeenCalledWith(UPCOMING_WEEK_ID);
  });

  it("calls requireAdmin with the resolved currentPlayerId", async () => {
    await GET(getRequest());

    expect(requireAdmin).toHaveBeenCalledTimes(1);
    expect(requireAdmin).toHaveBeenCalledWith(ADMIN_PLAYER_ID);
  });
});

// ---------------------------------------------------------------------------
// non-admin — 403 + service NOT called
// ---------------------------------------------------------------------------

describe("GET /api/admin/week/draft: non-admin actor", () => {
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
    const response = await GET(getRequest());

    expect(response.status).toBe(HTTP_FORBIDDEN);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
  });

  it("does NOT call getDraftQuestions when requireAdmin throws ForbiddenError", async () => {
    await GET(getRequest());

    expect(getDraftQuestions).not.toHaveBeenCalled();
  });
});
