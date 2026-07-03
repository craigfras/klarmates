/**
 * Tests for gameService.getDraftWeekInfo().
 *
 * CONTRACT DECISIONS (for code-writer):
 *
 *   getDraftWeekInfo(): Promise<{ weekId: string; startsAt: string } | null>
 *
 *   - Returns null when no draft week exists yet (a fresh service before any
 *     getDraftQuestions call — the seeded mock store does NOT seed draftWeek).
 *   - After getDraftQuestions(weekId) has created a draft, returns the draft
 *     week's id plus an ISO 8601 `startsAt` for that upcoming week. The
 *     `startsAt` must be a non-empty, parseable ISO string so the Questions
 *     screen can name the week (e.g. "Questions for the week of Jun 29, 2026").
 *
 *   The method must be added to the GameService interface and to the object
 *   returned by createMockGameService().
 */

import { describe, it, expect } from "vitest";
import { createMockGameService } from "@/lib/services/gameService";
import { UPCOMING_WEEK_ID } from "@/lib/types";
import type { Player, WeekStatus } from "@/lib/types";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const makePlayer = (id: string): Player => ({
  id,
  name: `Player ${id}`,
  email: `${id}@example.com`,
  isAdmin: false,
  active: true,
});

type ServiceData = Parameters<typeof createMockGameService>[0];

const buildScenario = (overrides: Partial<ServiceData> = {}): ServiceData => ({
  players: [makePlayer("p1"), makePlayer("p2")],
  currentWeek: {
    id: "week-current",
    startsAt: "2026-06-22T00:00:00.000Z",
    status: "open" as WeekStatus,
    questions: [],
  },
  matchups: [],
  byePlayerIds: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Interface exposure
// ---------------------------------------------------------------------------

describe("gameService.getDraftWeekInfo: interface", () => {
  it("exposes getDraftWeekInfo as a function", () => {
    const service = createMockGameService(buildScenario());
    expect(typeof service.getDraftWeekInfo).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// No draft week yet
// ---------------------------------------------------------------------------

describe("gameService.getDraftWeekInfo: no draft week", () => {
  it("returns null before any draft week has been created", async () => {
    const service = createMockGameService(buildScenario());

    await expect(service.getDraftWeekInfo()).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// After a draft week exists
// ---------------------------------------------------------------------------

describe("gameService.getDraftWeekInfo: with a draft week", () => {
  it("returns the draft week id and a non-empty ISO startsAt", async () => {
    const service = createMockGameService(buildScenario());

    // Creating the draft is what brings a draft week into existence.
    await service.getDraftQuestions(UPCOMING_WEEK_ID);

    const info = await service.getDraftWeekInfo();

    expect(info).not.toBeNull();
    expect(info?.weekId).toBe(UPCOMING_WEEK_ID);
    expect(info?.startsAt).not.toBe("");
    expect(Number.isNaN(new Date(info?.startsAt ?? "").getTime())).toBe(false);
  });
});
