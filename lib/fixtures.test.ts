import { describe, it, expect } from "vitest";
import {
  players,
  currentWeek,
  matchups,
  byePlayerIds,
  type FixtureMatchup,
} from "@/lib/fixtures";
import type { Player } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

const MIN_PLAYERS = 3;
const EXPECTED_QUESTION_COUNT = 4;
const EXPECTED_ORDER_INDICES = [0, 1, 2, 3];
const MIN_MATCHUPS = 1;

// ---------------------------------------------------------------------------
// players
// ---------------------------------------------------------------------------

describe("fixtures: players", () => {
  it("contains at least the minimum number of players", () => {
    expect(players.length).toBeGreaterThanOrEqual(MIN_PLAYERS);
  });

  it("has unique, stable, non-empty player ids", () => {
    const ids = players.map((p) => p.id);
    ids.forEach((id) => {
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("exposes well-formed Player records", () => {
    players.forEach((p: Player) => {
      expect(typeof p.name).toBe("string");
      expect(typeof p.email).toBe("string");
      expect(typeof p.isAdmin).toBe("boolean");
      expect(typeof p.active).toBe("boolean");
    });
  });
});

// ---------------------------------------------------------------------------
// currentWeek
// ---------------------------------------------------------------------------

describe("fixtures: currentWeek", () => {
  it("has a non-empty id and a valid WeekStatus", () => {
    expect(typeof currentWeek.id).toBe("string");
    expect(currentWeek.id.length).toBeGreaterThan(0);
    expect([
      "draft_questions",
      "awaiting_approval",
      "open",
      "closed",
    ]).toContain(currentWeek.status);
  });

  it("has exactly four questions", () => {
    expect(currentWeek.questions).toHaveLength(EXPECTED_QUESTION_COUNT);
  });

  it("has questions whose orderIndex set is exactly {0,1,2,3}", () => {
    const indices = currentWeek.questions
      .map((q) => q.orderIndex)
      .sort((a, b) => a - b);
    expect(indices).toEqual(EXPECTED_ORDER_INDICES);
  });

  it("has questions with unique ids and non-empty text", () => {
    const ids = currentWeek.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    currentWeek.questions.forEach((q) => {
      expect(q.text.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// matchups
// ---------------------------------------------------------------------------

describe("fixtures: matchups", () => {
  it("contains at least one matchup", () => {
    expect(matchups.length).toBeGreaterThanOrEqual(MIN_MATCHUPS);
  });

  it("references the current week and only real player ids", () => {
    const playerIds = new Set(players.map((p) => p.id));
    matchups.forEach((m: FixtureMatchup) => {
      expect(m.weekId).toBe(currentWeek.id);
      expect(playerIds.has(m.playerAId)).toBe(true);
      expect(playerIds.has(m.playerBId)).toBe(true);
      expect(m.playerAId).not.toBe(m.playerBId);
      m.answeredBy.forEach((id) => {
        expect(playerIds.has(id)).toBe(true);
        // answeredBy may only contain the two participants of the matchup
        expect([m.playerAId, m.playerBId]).toContain(id);
      });
    });
  });

  it("has unique matchup ids", () => {
    const ids = matchups.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// byePlayerIds
// ---------------------------------------------------------------------------

describe("fixtures: byePlayerIds", () => {
  it("only references real player ids", () => {
    const playerIds = new Set(players.map((p) => p.id));
    byePlayerIds.forEach((id) => {
      expect(playerIds.has(id)).toBe(true);
    });
  });

  it("does not include any player who is also in a matchup", () => {
    const matchupPlayerIds = new Set(
      matchups.flatMap((m) => [m.playerAId, m.playerBId]),
    );
    byePlayerIds.forEach((id) => {
      expect(matchupPlayerIds.has(id)).toBe(false);
    });
  });
});
