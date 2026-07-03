/**
 * Scoring & ranking — pure functions.
 *
 * The weekly scoring rules (participation + correct guesses, with byes scoring
 * zero) and the leaderboard ranking (competition ranking with shared rank for
 * true ties) live here as pure TypeScript so they can be unit-tested in
 * isolation and reused by the game service. No I/O, no side effects.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of correct guesses available in a single week. */
export const QUESTIONS_PER_WEEK = 4;
// (max weekly total = QUESTIONS_PER_WEEK + 1 participation = 5)

/** Participation point awarded for submitting one's own answers. */
const PARTICIPATION_AWARDED: WeeklyScore["participation"] = 1;
const PARTICIPATION_NONE: WeeklyScore["participation"] = 0;

/** First place in 1-based competition ranking. */
const FIRST_RANK = 1;

// ---------------------------------------------------------------------------
// Weekly scoring
// ---------------------------------------------------------------------------

export type ScoreInput = {
  submittedOwnAnswers: boolean;
  correctGuesses: number;
  isBye: boolean;
};

export type WeeklyScore = {
  participation: 0 | 1;
  correctGuesses: number;
  total: number;
};

/**
 * Scores one player's week.
 *
 * - A bye scores all zero regardless of any other input.
 * - Otherwise participation is 1 when own answers were submitted, else 0; the
 *   correct-guess count passes through and the total is their sum.
 * - The "silent opponent" case is implicit: submitted with zero correct guesses
 *   yields participation 1 / total 1.
 */
export const scoreWeekForPlayer = (input: ScoreInput): WeeklyScore => {
  if (input.isBye) {
    return { participation: PARTICIPATION_NONE, correctGuesses: 0, total: 0 };
  }

  const participation = input.submittedOwnAnswers
    ? PARTICIPATION_AWARDED
    : PARTICIPATION_NONE;

  return {
    participation,
    correctGuesses: input.correctGuesses,
    total: participation + input.correctGuesses,
  };
};

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export type ScoreRow = {
  playerId: string;
  name: string;
  total: number;
  correctGuesses: number;
};

export type RankedRow = ScoreRow & { rank: number };

/** Two rows are a TRUE tie only when both total and correctGuesses match. */
const isTrueTie = (a: ScoreRow, b: ScoreRow): boolean =>
  a.total === b.total && a.correctGuesses === b.correctGuesses;

/**
 * Ranks rows by total descending, then correctGuesses descending. True ties
 * (same total AND same correctGuesses) share a rank; the next distinct row
 * takes its 1-based position (competition numbering, e.g. 1, 2, 2, 4). Does not
 * mutate the input array.
 */
export const rankPlayers = (rows: ScoreRow[]): RankedRow[] => {
  const sorted = [...rows].sort(
    (a, b) => b.total - a.total || b.correctGuesses - a.correctGuesses,
  );

  let currentRank = FIRST_RANK;
  return sorted.map((row, index) => {
    const previous = sorted[index - 1];
    // A true tie inherits the previous rank; otherwise the rank jumps to this
    // row's 1-based position (competition numbering).
    if (previous !== undefined && !isTrueTie(previous, row)) {
      currentRank = index + FIRST_RANK;
    }
    return { ...row, rank: currentRank };
  });
};
