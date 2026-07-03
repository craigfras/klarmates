import { describe, it, expect } from "vitest";
import { createMockGameService } from "@/lib/services/gameService";
import { getMockStore } from "@/lib/mockStore";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

// A player the seeded historySeed (lib/fixtures.ts) has past entries for.
const PLAYER_WITH_HISTORY = "player-ada";

// ---------------------------------------------------------------------------
// getMyHistory: startsAt + shape
// ---------------------------------------------------------------------------

describe("createMockGameService.getMyHistory: startsAt", () => {
  it("returns entries each carrying a non-empty, parseable startsAt", async () => {
    const service = createMockGameService(getMockStore());

    const entries = await service.getMyHistory(PLAYER_WITH_HISTORY);

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      // A real ISO date the History view can format.
      expect(entry.startsAt).not.toBe("");
      expect(Number.isNaN(new Date(entry.startsAt).getTime())).toBe(false);
    }
  });

  it("keeps the existing entry shape (weekId, opponentName, recap) intact", async () => {
    const service = createMockGameService(getMockStore());

    const [entry] = await service.getMyHistory(PLAYER_WITH_HISTORY);

    expect(typeof entry.weekId).toBe("string");
    expect(entry.weekId.length).toBeGreaterThan(0);
    expect(typeof entry.opponentName).toBe("string");
    expect(entry.opponentName.length).toBeGreaterThan(0);
    expect(entry.recap).toMatchObject({
      meCorrect: expect.any(Number),
      opponentCorrect: expect.any(Number),
      questionCount: expect.any(Number),
    });
  });
});
