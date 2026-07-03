/**
 * Tests for POST /api/admin/week/restart.
 *
 * Mirrors app/api/admin/week/approve/route.test.ts exactly: same mocks for
 * @/lib/services (the gameService seam) and the dev-actor / requireAdmin
 * admin guard. The route resolves the admin actor, parses { weekId }, then
 * delegates to gameService.restartWeek(weekId). Auth failures → 403;
 * malformed body / service rejection → 400; success → 200 { ok: true }.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { UPCOMING_WEEK_ID } from "@/lib/types";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const ADMIN_PLAYER_ID = "player-admin";
const NON_ADMIN_PLAYER_ID = "player-ada";
const ROUTE_URL = "http://localhost/api/admin/week/restart";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;

// Raw, unparseable body — deliberately NOT JSON.stringify-ed so request.json()
// throws. Regression for the parse happening outside the try/catch.
const MALFORMED_BODY = "{ this is not valid json";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const restartWeek = vi.fn();

vi.mock("@/lib/use-cases/getDevActor", () => ({
  getDevActor: vi.fn(async () => ({
    players: [],
    currentPlayerId: ADMIN_PLAYER_ID,
    currentPlayer: { id: ADMIN_PLAYER_ID, isAdmin: true },
  })),
}));

vi.mock("@/lib/services", () => ({
  gameService: {
    restartWeek: (...args: unknown[]) => restartWeek(...args),
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
import { POST } from "@/app/api/admin/week/restart/route";
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
  restartWeek.mockReset();
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(getDevActor).mockReset();

  // Default: admin actor, requireAdmin succeeds, restartWeek resolves.
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
  restartWeek.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// admin — 200 + { ok: true }
// ---------------------------------------------------------------------------

describe("POST /api/admin/week/restart: admin actor", () => {
  it("returns 200 with { ok: true } on success", async () => {
    const response = await POST(postRequest({ weekId: UPCOMING_WEEK_ID }));

    expect(response.status).toBe(HTTP_OK);
    const json = await response.json();
    expect(json.ok).toBe(true);
  });

  it("calls restartWeek exactly once with the provided weekId", async () => {
    await POST(postRequest({ weekId: UPCOMING_WEEK_ID }));

    expect(restartWeek).toHaveBeenCalledTimes(1);
    expect(restartWeek).toHaveBeenCalledWith(UPCOMING_WEEK_ID);
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

describe("POST /api/admin/week/restart: non-admin actor", () => {
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
    const response = await POST(postRequest({ weekId: UPCOMING_WEEK_ID }));

    expect(response.status).toBe(HTTP_FORBIDDEN);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
  });

  it("does NOT call restartWeek when requireAdmin throws ForbiddenError", async () => {
    await POST(postRequest({ weekId: UPCOMING_WEEK_ID }));

    expect(restartWeek).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// service rejection — 400 with thrown message
// ---------------------------------------------------------------------------

describe("POST /api/admin/week/restart: service error", () => {
  it("returns 400 with the thrown message when restartWeek rejects", async () => {
    restartWeek.mockRejectedValue(
      new Error('Week "week-2026-99" is not the current open week.'),
    );

    const response = await POST(postRequest({ weekId: "week-2026-99" }));

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(json.error).toBe('Week "week-2026-99" is not the current open week.');
  });
});

// ---------------------------------------------------------------------------
// malformed body (regression)
// ---------------------------------------------------------------------------

describe("POST /api/admin/week/restart: malformed body", () => {
  it("returns 400 and does not call restartWeek when the body is not valid JSON", async () => {
    const response = await POST(
      new Request(ROUTE_URL, { method: "POST", body: MALFORMED_BODY }),
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(restartWeek).not.toHaveBeenCalled();
  });
});
