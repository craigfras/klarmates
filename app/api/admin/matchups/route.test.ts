import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Test constants (no magic numbers)
// ---------------------------------------------------------------------------

const ADMIN_PLAYER_ID = "player-admin";
const NON_ADMIN_PLAYER_ID = "player-ada";
const ROUTE_URL = "http://localhost/api/admin/matchups";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const getAdminMatchups = vi.fn();

vi.mock("@/lib/use-cases/getDevActor", () => ({
  getDevActor: vi.fn(async () => ({
    players: [],
    currentPlayerId: ADMIN_PLAYER_ID,
    currentPlayer: { id: ADMIN_PLAYER_ID, isAdmin: true },
  })),
}));

vi.mock("@/lib/services", () => ({
  gameService: {
    getAdminMatchups: (...args: unknown[]) => getAdminMatchups(...args),
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
import { GET } from "@/app/api/admin/matchups/route";
import { getDevActor } from "@/lib/use-cases/getDevActor";
import { requireAdmin, ForbiddenError } from "@/lib/authz";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_OVERVIEW = {
  weekId: "week-test-1",
  weekStatus: "open",
  matchups: [
    {
      matchupId: "m1",
      playerA: { id: "p1", name: "Ada Lovelace", answered: true },
      playerB: { id: "p2", name: "Linus Bytes", answered: false },
      status: "awaiting_one",
    },
  ],
  byePlayers: [{ id: "p3", name: "Grace Hopper" }],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getRequest = (): Request =>
  new Request(ROUTE_URL, { method: "GET" });

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  getAdminMatchups.mockReset();
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(getDevActor).mockReset();

  // Default: admin actor, requireAdmin succeeds, getAdminMatchups resolves.
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
  getAdminMatchups.mockResolvedValue(MOCK_OVERVIEW);
});

// ---------------------------------------------------------------------------
// admin — 200 + overview forwarded verbatim
// ---------------------------------------------------------------------------

describe("GET /api/admin/matchups: admin actor", () => {
  it("returns 200 when the actor is an admin", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(HTTP_OK);
  });

  it("returns the AdminWeekOverview from getAdminMatchups() verbatim in the body", async () => {
    const response = await GET(getRequest());

    const json = await response.json();
    expect(json).toEqual(MOCK_OVERVIEW);
  });

  it("calls getAdminMatchups exactly once", async () => {
    await GET(getRequest());

    expect(getAdminMatchups).toHaveBeenCalledTimes(1);
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

describe("GET /api/admin/matchups: non-admin actor", () => {
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

  it("returns 403 with an error string when requireAdmin throws ForbiddenError", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(HTTP_FORBIDDEN);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
  });

  it("does NOT call getAdminMatchups when requireAdmin throws ForbiddenError", async () => {
    await GET(getRequest());

    expect(getAdminMatchups).not.toHaveBeenCalled();
  });
});
