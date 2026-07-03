/**
 * Tests for GET /api/cron/draft-week (slice 13).
 *
 * Vercel Cron hits this route with GET + a `Bearer <CRON_SECRET>` header. The
 * handler verifies the request via isAuthorizedCron, then delegates to the
 * draftNextWeek job body. Unauthorized → 401 and the job is NOT invoked;
 * authorized → 200 with a JSON body carrying the job's summary.
 *
 * "@/lib/cronAuth" and "@/lib/jobs" are mocked so no DB is touched. Pre-
 * implementation the route module + those modules don't exist, so the imports
 * fail to resolve and every test fails for that reason until they're written.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { UPCOMING_WEEK_ID } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const CALLED_ONCE = 1;
const REQUEST_URL = "https://x/api/cron/draft-week";

const DRAFT_SUMMARY = { weekId: UPCOMING_WEEK_ID, questionCount: 4 };

// ---------------------------------------------------------------------------
// Mocks (registered before importing the route)
// ---------------------------------------------------------------------------

const isAuthorizedCron = vi.fn();
const draftNextWeek = vi.fn();

vi.mock("@/lib/cronAuth", () => ({
  isAuthorizedCron: (...args: unknown[]) => isAuthorizedCron(...args),
}));

vi.mock("@/lib/jobs", () => ({
  draftNextWeek: (...args: unknown[]) => draftNextWeek(...args),
}));

// Imported AFTER the mocks are registered.
import { GET } from "@/app/api/cron/draft-week/route";

// ---------------------------------------------------------------------------
// Helpers + setup
// ---------------------------------------------------------------------------

const cronRequest = (): Request => new Request(REQUEST_URL);

beforeEach(() => {
  isAuthorizedCron.mockReset();
  draftNextWeek.mockReset();
  draftNextWeek.mockResolvedValue(DRAFT_SUMMARY);
});

// ---------------------------------------------------------------------------
// Unauthorized → 401, job not invoked
// ---------------------------------------------------------------------------

describe("GET /api/cron/draft-week: unauthorized", () => {
  it("returns 401 and does NOT invoke draftNextWeek", async () => {
    isAuthorizedCron.mockReturnValue(false);

    const response = await GET(cronRequest());

    expect(response.status).toBe(HTTP_UNAUTHORIZED);
    expect(draftNextWeek).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Authorized → 200 + job summary
// ---------------------------------------------------------------------------

describe("GET /api/cron/draft-week: authorized", () => {
  it("invokes draftNextWeek and returns 200 with the job summary", async () => {
    isAuthorizedCron.mockReturnValue(true);

    const response = await GET(cronRequest());

    expect(draftNextWeek).toHaveBeenCalledTimes(CALLED_ONCE);
    expect(response.status).toBe(HTTP_OK);
    const json = await response.json();
    expect(json).toMatchObject(DRAFT_SUMMARY);
  });
});
