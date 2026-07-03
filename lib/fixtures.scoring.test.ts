import { describe, it, expect } from "vitest";
import { players, leaderboardSeed, historySeed } from "@/lib/fixtures";
import type {
  HistoryEntry,
  LeaderboardSeedRow,
  Player,
  ScopeScore,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

const EXPECTED_LEADERBOARD_ROWS = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isValidScope = (scope: ScopeScore): boolean =>
  typeof scope.total === "number" &&
  Number.isFinite(scope.total) &&
  typeof scope.correctGuesses === "number" &&
  Number.isFinite(scope.correctGuesses);

// ---------------------------------------------------------------------------
// leaderboardSeed
// ---------------------------------------------------------------------------

describe("fixtures scoring: leaderboardSeed", () => {
  it("covers all five players exactly once", () => {
    const playerIds = new Set(players.map((p: Player) => p.id));
    const seededIds = leaderboardSeed.map((row: LeaderboardSeedRow) => row.playerId);

    expect(leaderboardSeed).toHaveLength(EXPECTED_LEADERBOARD_ROWS);
    expect(new Set(seededIds).size).toBe(seededIds.length);
    seededIds.forEach((id: string) => {
      expect(playerIds.has(id)).toBe(true);
    });
    // Every roster player has a row.
    expect(new Set(seededIds)).toEqual(playerIds);
  });

  it("gives every row numeric season and allTime scores", () => {
    leaderboardSeed.forEach((row: LeaderboardSeedRow) => {
      expect(isValidScope(row.season)).toBe(true);
      expect(isValidScope(row.allTime)).toBe(true);
    });
  });

  it("encodes a season total tie broken by correctGuesses (ada over linus)", () => {
    const byId = (id: string): LeaderboardSeedRow | undefined =>
      leaderboardSeed.find((row: LeaderboardSeedRow) => row.playerId === id);

    const ada = byId("player-ada");
    const linus = byId("player-linus");
    expect(ada).toBeDefined();
    expect(linus).toBeDefined();

    // Equal season total, Ada ahead on correctGuesses.
    expect(ada!.season.total).toBe(linus!.season.total);
    expect(ada!.season.correctGuesses).toBeGreaterThan(
      linus!.season.correctGuesses,
    );
  });
});

// ---------------------------------------------------------------------------
// historySeed
// ---------------------------------------------------------------------------

describe("fixtures scoring: historySeed", () => {
  it("keys entries by real player ids", () => {
    const playerIds = new Set(players.map((p: Player) => p.id));

    Object.keys(historySeed).forEach((playerId: string) => {
      expect(playerIds.has(playerId)).toBe(true);
    });
  });

  it("provides well-formed Recap entries for at least ada, linus and grace", () => {
    const REQUIRED = ["player-ada", "player-linus", "player-grace"];

    REQUIRED.forEach((id: string) => {
      const entries = historySeed[id];
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThan(0);

      entries.forEach((entry: HistoryEntry) => {
        expect(typeof entry.weekId).toBe("string");
        expect(entry.weekId.length).toBeGreaterThan(0);
        expect(typeof entry.opponentName).toBe("string");
        expect(entry.opponentName.length).toBeGreaterThan(0);

        expect(typeof entry.recap.meCorrect).toBe("number");
        expect(typeof entry.recap.opponentCorrect).toBe("number");
        expect(typeof entry.recap.questionCount).toBe("number");
        expect(entry.recap.questionCount).toBeGreaterThan(0);
      });
    });
  });
});
