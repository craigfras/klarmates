/**
 * Tests for POST /api/admin/jobs/season-rollover (admin manual cron trigger).
 *
 * Mirrors app/api/admin/week/approve/route.test.ts: the real requireAdminActor
 * gate runs (getDevActor + requireAdmin/ForbiddenError are mocked), and the
 * underlying job is mocked via "@/lib/jobs" so no DB is touched.
 *
 * IMPORTANT: this admin route delegates to the FORCE variant
 * `forceRolloverSeason` (roll over regardless of the isSeasonExpired guard),
 * NOT the cron-guarded `rolloverSeasonIfDue`. We assert forceRolloverSeason is
 * invoked and that rolloverSeasonIfDue is NOT, to lock in the force behaviour.
 *
 * Contract (intended new route):
 *   POST /api/admin/jobs/season-rollover — admin-only, no request body.
 *     - non-admin  → 403, forceRolloverSeason NOT called.
 *     - admin      → forceRolloverSeason called exactly once; its return echoed
 *                    as JSON with status 200; rolloverSeasonIfDue NOT called.
 *     - job throws → 400 via mapAdminError, body carries the error message.
 *
 * Pre-implementation the route module does not exist, so the import fails to
 * resolve and every test fails for that reason until it is written.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const ADMIN_PLAYER_ID = "player-admin";
const NON_ADMIN_PLAYER_ID = "player-ada";
const ROUTE_URL = "http://localhost/api/admin/jobs/season-rollover";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const CALLED_ONCE = 1;

const NEW_SEASON_ID = "season-next";
const JOB_SUMMARY = { rolledOver: true, newSeasonId: NEW_SEASON_ID };
const JOB_ERROR_MESSAGE = "Rollover failed: no current season.";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const forceRolloverSeason = vi.fn();
const rolloverSeasonIfDue = vi.fn();

vi.mock("@/lib/use-cases/getDevActor", () => ({
  getDevActor: vi.fn(async () => ({
    players: [],
    currentPlayerId: ADMIN_PLAYER_ID,
    currentPlayer: { id: ADMIN_PLAYER_ID, isAdmin: true },
  })),
}));

vi.mock("@/lib/jobs", () => ({
  forceRolloverSeason: (...args: unknown[]) => forceRolloverSeason(...args),
  rolloverSeasonIfDue: (...args: unknown[]) => rolloverSeasonIfDue(...args),
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
import { POST } from "@/app/api/admin/jobs/season-rollover/route";
import { getDevActor } from "@/lib/use-cases/getDevActor";
import { requireAdmin, ForbiddenError } from "@/lib/authz";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const postRequest = (): Request => new Request(ROUTE_URL, { method: "POST" });

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  forceRolloverSeason.mockReset();
  rolloverSeasonIfDue.mockReset();
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(getDevActor).mockReset();

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
  forceRolloverSeason.mockResolvedValue(JOB_SUMMARY);
});

// ---------------------------------------------------------------------------
// admin — 200 + job summary echoed (FORCE variant)
// ---------------------------------------------------------------------------

describe("POST /api/admin/jobs/season-rollover: admin actor", () => {
  it("calls the FORCE variant forceRolloverSeason exactly once (not rolloverSeasonIfDue)", async () => {
    await POST(postRequest());

    expect(forceRolloverSeason).toHaveBeenCalledTimes(CALLED_ONCE);
    expect(rolloverSeasonIfDue).not.toHaveBeenCalled();
  });

  it("returns 200 echoing the job's summary JSON", async () => {
    const response = await POST(postRequest());

    expect(response.status).toBe(HTTP_OK);
    const json = await response.json();
    expect(json).toMatchObject(JOB_SUMMARY);
  });
});

// ---------------------------------------------------------------------------
// non-admin — 403 + job NOT called
// ---------------------------------------------------------------------------

describe("POST /api/admin/jobs/season-rollover: non-admin actor", () => {
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
    const response = await POST(postRequest());

    expect(response.status).toBe(HTTP_FORBIDDEN);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
  });

  it("does NOT call forceRolloverSeason", async () => {
    await POST(postRequest());

    expect(forceRolloverSeason).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// job rejection — 400 with thrown message
// ---------------------------------------------------------------------------

describe("POST /api/admin/jobs/season-rollover: job error", () => {
  it("returns 400 with the thrown message when forceRolloverSeason rejects", async () => {
    forceRolloverSeason.mockRejectedValue(new Error(JOB_ERROR_MESSAGE));

    const response = await POST(postRequest());

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(json.error).toBe(JOB_ERROR_MESSAGE);
  });
});
