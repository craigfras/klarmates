import { describe, it, expect } from "vitest";
import {
  QUESTIONS_PER_WEEK,
  scoreWeekForPlayer,
  rankPlayers,
  type ScoreInput,
  type ScoreRow,
} from "@/lib/scoring";

// ---------------------------------------------------------------------------
// Test helpers / builders
// ---------------------------------------------------------------------------

const makeInput = (overrides: Partial<ScoreInput> = {}): ScoreInput => ({
  submittedOwnAnswers: true,
  correctGuesses: 0,
  isBye: false,
  ...overrides,
});

const makeRow = (
  playerId: string,
  total: number,
  correctGuesses: number,
): ScoreRow => ({
  playerId,
  name: `Name ${playerId}`,
  total,
  correctGuesses,
});

// The maximum weekly total: every question guessed correctly plus participation.
const MAX_WEEKLY_TOTAL = QUESTIONS_PER_WEEK + 1;

// ---------------------------------------------------------------------------
// QUESTIONS_PER_WEEK constant
// ---------------------------------------------------------------------------

describe("scoring: QUESTIONS_PER_WEEK", () => {
  it("is four (the number of questions per week)", () => {
    expect(QUESTIONS_PER_WEEK).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// scoreWeekForPlayer: normal play
// ---------------------------------------------------------------------------

describe("scoreWeekForPlayer: normal play", () => {
  it("awards participation 1 plus N correct → total N+1 when submitted with some correct", () => {
    const score = scoreWeekForPlayer(
      makeInput({ submittedOwnAnswers: true, correctGuesses: 2 }),
    );

    expect(score).toEqual({ participation: 1, correctGuesses: 2, total: 3 });
  });
});

// ---------------------------------------------------------------------------
// scoreWeekForPlayer: perfect week
// ---------------------------------------------------------------------------

describe("scoreWeekForPlayer: perfect week", () => {
  it("scores a perfect 4/4 with participation as total 5", () => {
    const score = scoreWeekForPlayer(
      makeInput({
        submittedOwnAnswers: true,
        correctGuesses: QUESTIONS_PER_WEEK,
      }),
    );

    expect(score).toEqual({
      participation: 1,
      correctGuesses: QUESTIONS_PER_WEEK,
      total: MAX_WEEKLY_TOTAL,
    });
    expect(score.total).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// scoreWeekForPlayer: bye
// ---------------------------------------------------------------------------

describe("scoreWeekForPlayer: bye", () => {
  it("scores all zero for a bye, ignoring other (nonzero) inputs", () => {
    const score = scoreWeekForPlayer({
      submittedOwnAnswers: true,
      correctGuesses: QUESTIONS_PER_WEEK,
      isBye: true,
    });

    expect(score).toEqual({ participation: 0, correctGuesses: 0, total: 0 });
  });
});

// ---------------------------------------------------------------------------
// scoreWeekForPlayer: silent opponent
// ---------------------------------------------------------------------------

describe("scoreWeekForPlayer: silent opponent", () => {
  it("gives participation 1 / total 1 when submitted with zero correct guesses", () => {
    const score = scoreWeekForPlayer(
      makeInput({ submittedOwnAnswers: true, correctGuesses: 0 }),
    );

    expect(score).toEqual({ participation: 1, correctGuesses: 0, total: 1 });
  });
});

// ---------------------------------------------------------------------------
// scoreWeekForPlayer: not submitted
// ---------------------------------------------------------------------------

describe("scoreWeekForPlayer: not submitted", () => {
  it("gives participation 0 when own answers were not submitted", () => {
    const score = scoreWeekForPlayer(
      makeInput({ submittedOwnAnswers: false, correctGuesses: 3 }),
    );

    expect(score).toEqual({ participation: 0, correctGuesses: 3, total: 3 });
  });

  it("totals zero when not submitted and no correct guesses", () => {
    const score = scoreWeekForPlayer(
      makeInput({ submittedOwnAnswers: false, correctGuesses: 0 }),
    );

    expect(score).toEqual({ participation: 0, correctGuesses: 0, total: 0 });
  });
});

// ---------------------------------------------------------------------------
// rankPlayers: ordering by total
// ---------------------------------------------------------------------------

describe("rankPlayers: ordering", () => {
  it("orders rows by total descending", () => {
    const ranked = rankPlayers([
      makeRow("low", 1, 0),
      makeRow("high", 5, 4),
      makeRow("mid", 3, 2),
    ]);

    expect(ranked.map((row) => row.playerId)).toEqual(["high", "mid", "low"]);
    expect(ranked.map((row) => row.rank)).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// rankPlayers: tiebreak by correctGuesses
// ---------------------------------------------------------------------------

describe("rankPlayers: tiebreak", () => {
  it("breaks a total tie by correctGuesses descending", () => {
    const ranked = rankPlayers([
      makeRow("fewerCorrect", 5, 3),
      makeRow("moreCorrect", 5, 4),
    ]);

    expect(ranked.map((row) => row.playerId)).toEqual([
      "moreCorrect",
      "fewerCorrect",
    ]);
    // Same total but distinct correctGuesses → distinct ranks.
    expect(ranked.map((row) => row.rank)).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// rankPlayers: true ties → shared rank (competition numbering)
// ---------------------------------------------------------------------------

describe("rankPlayers: true ties", () => {
  it("assigns an equal rank to a TRUE tie and skips numbers (1,2,2,4)", () => {
    const ranked = rankPlayers([
      makeRow("first", 5, 4),
      makeRow("tieB", 3, 2),
      makeRow("tieA", 3, 2),
      makeRow("last", 1, 0),
    ]);

    // The two rows with the same total AND same correctGuesses share rank 2,
    // and the next distinct row takes rank 4 (competition numbering).
    expect(ranked.map((row) => row.rank)).toEqual([1, 2, 2, 4]);

    // The first row is unambiguously the top.
    expect(ranked[0].playerId).toBe("first");
    // The last row trails everyone.
    expect(ranked[3].playerId).toBe("last");
    expect(ranked[3].rank).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// rankPlayers: purity (no input mutation)
// ---------------------------------------------------------------------------

describe("rankPlayers: purity", () => {
  it("does not mutate the input array (order or elements)", () => {
    const input: ScoreRow[] = [
      makeRow("low", 1, 0),
      makeRow("high", 5, 4),
      makeRow("mid", 3, 2),
    ];
    const snapshot = input.map((row) => ({ ...row }));

    rankPlayers(input);

    // Original order is preserved.
    expect(input.map((row) => row.playerId)).toEqual(["low", "high", "mid"]);
    // No rank property leaked onto the originals.
    expect(input).toEqual(snapshot);
    input.forEach((row) => {
      expect("rank" in row).toBe(false);
    });
  });
});
