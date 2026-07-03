/**
 * Tests for POST /api/admin/jobs/close-week (admin manual cron trigger).
 *
 * Mirrors app/api/admin/week/approve/route.test.ts: the real requireAdminActor
 * gate runs (getDevActor + requireAdmin/ForbiddenError are mocked), and the
 * underlying job is mocked via "@/lib/jobs" so no DB is touched.
 *
 * IMPORTANT: this admin route delegates to the FORCE variant `closeCurrentWeek`
 * (close ANY open week regardless of endsAt), NOT the cron-guarded
 * `closeOpenWeek`. We assert closeCurrentWeek is invoked and that closeOpenWeek
 * is NOT, to lock in the force behaviour.
 *
 * Contract (intended new route):
 *   POST /api/admin/jobs/close-week — admin-only, no request body.
 *     - non-admin  → 403, closeCurrentWeek NOT called.
 *     - admin      → closeCurrentWeek called exactly once; its return echoed as
 *                    JSON with status 200; closeOpenWeek NOT called.
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
const ROUTE_URL = "http://localhost/api/admin/jobs/close-week";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const CALLED_ONCE = 1;

const CLOSED_WEEK_ID = "w1";
const JOB_SUMMARY = { closed: true, weekId: CLOSED_WEEK_ID };
const JOB_ERROR_MESSAGE = "Close failed: no open week.";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const closeCurrentWeek = vi.fn();
const closeOpenWeek = vi.fn();

vi.mock("@/lib/use-cases/getDevActor", () => ({
  getDevActor: vi.fn(async () => ({
    players: [],
    currentPlayerId: ADMIN_PLAYER_ID,
    currentPlayer: { id: ADMIN_PLAYER_ID, isAdmin: true },
  })),
}));

vi.mock("@/lib/jobs", () => ({
  closeCurrentWeek: (...args: unknown[]) => closeCurrentWeek(...args),
  closeOpenWeek: (...args: unknown[]) => closeOpenWeek(...args),
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
import { POST } from "@/app/api/admin/jobs/close-week/route";
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
  closeCurrentWeek.mockReset();
  closeOpenWeek.mockReset();
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
  closeCurrentWeek.mockResolvedValue(JOB_SUMMARY);
});

// ---------------------------------------------------------------------------
// admin — 200 + job summary echoed (FORCE variant)
// ---------------------------------------------------------------------------

describe("POST /api/admin/jobs/close-week: admin actor", () => {
  it("calls the FORCE variant closeCurrentWeek exactly once (not closeOpenWeek)", async () => {
    await POST(postRequest());

    expect(closeCurrentWeek).toHaveBeenCalledTimes(CALLED_ONCE);
    expect(closeOpenWeek).not.toHaveBeenCalled();
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

describe("POST /api/admin/jobs/close-week: non-admin actor", () => {
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

  it("does NOT call closeCurrentWeek", async () => {
    await POST(postRequest());

    expect(closeCurrentWeek).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// job rejection — 400 with thrown message
// ---------------------------------------------------------------------------

describe("POST /api/admin/jobs/close-week: job error", () => {
  it("returns 400 with the thrown message when closeCurrentWeek rejects", async () => {
    closeCurrentWeek.mockRejectedValue(new Error(JOB_ERROR_MESSAGE));

    const response = await POST(postRequest());

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(json.error).toBe(JOB_ERROR_MESSAGE);
  });
});
