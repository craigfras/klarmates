/**
 * Domain types for the Engineer Guessing Game.
 *
 * These mirror the data model in spec/engineer-guessing-game/spec.md and are the
 * shared contract consumed by services, views, and (later) the data layer.
 */

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

export type Player = {
  id: string;
  name: string;
  email: string;
  slackUserId?: string;
  isAdmin: boolean;
  active: boolean;
};

export type Question = {
  id: string;
  orderIndex: number;
  text: string;
};

export type AnswerOption = {
  id: string;
  text: string;
  isCorrect: boolean;
};

// ---------------------------------------------------------------------------
// Answer submission
// ---------------------------------------------------------------------------

/** Number of questions a player answers each week. */
export const WEEKLY_QUESTION_COUNT = 4;

/** The upcoming week that admins draft questions for and then open to players. */
export const UPCOMING_WEEK_ID = "week-2026-26";

/** A single answer a player submits for one question. */
export type AnswerSubmission = { questionId: string; text: string };

/** A player's persisted answer to one question within a matchup. */
export type StoredAnswer = {
  id: string;
  matchupId: string;
  questionId: string;
  playerId: string;
  text: string;
};

/** A persisted answer option, linked back to the answer it belongs to. */
export type StoredAnswerOption = AnswerOption & { answerId: string };

// ---------------------------------------------------------------------------
// Question suggestions
// ---------------------------------------------------------------------------

/** A player-authored candidate question in the standing suggestion pool. */
export type StoredSuggestion = {
  id: string;
  text: string;
  suggestedById: string; // player id
  createdAt: string; // ISO 8601
};

/**
 * The read shape surfaced to the admin UI: a pooled suggestion with the
 * suggester's NAME resolved server-side (mock: from the roster; db: joined
 * Player).
 */
export type QuestionSuggestion = {
  id: string;
  text: string;
  suggestedByName: string;
  createdAt: string; // ISO 8601
};

// ---------------------------------------------------------------------------
// Week lifecycle
// ---------------------------------------------------------------------------

export type WeekStatus =
  | "draft_questions"
  | "awaiting_approval"
  | "open"
  | "closed";

// ---------------------------------------------------------------------------
// Player-facing aggregates
// ---------------------------------------------------------------------------

export type Recap = {
  meCorrect: number;
  opponentCorrect: number;
  questionCount: number;
};

export type MyWeekView = {
  weekId: string;
  /** ISO 8601 start date-time of the week; "" in the cold-start no-week case. */
  startsAt: string;
  status: WeekStatus;
  opponent: Player | null;
  isBye: boolean;
  questions: Question[];
  myAnswersSubmitted: boolean;
  opponentAnswered: boolean;
  guessingUnlocked: boolean;
  /**
   * True iff guessing is unlocked AND the player has guessed every question;
   * false otherwise (bye / cold-start / not-unlocked / partially guessed).
   */
  guessingComplete: boolean;
  /**
   * Count of the player's CORRECT guesses this week (0 when none / bye /
   * cold-start / not-yet-guessed).
   */
  myCorrectGuesses: number;
  recap?: Recap;
};

// ---------------------------------------------------------------------------
// Guess flow
// ---------------------------------------------------------------------------

// Client-safe option: the real answer's isCorrect flag is intentionally absent
// so the guess sheet sent to the client can never leak which option is right.
export type GuessOption = { id: string; text: string };

export type GuessSheetItem = {
  questionId: string;
  questionText: string;
  options: GuessOption[]; // shuffled, isCorrect stripped
  /** The player's prior guess result for this question, or null if not yet guessed. */
  result: GuessResult | null;
};
export type GuessSheet = GuessSheetItem[];

export type GuessResult = {
  questionId: string;
  correct: boolean;
  realAnswerText: string;
};

export type StoredGuess = {
  id: string;
  matchupId: string;
  questionId: string;
  guesserId: string;
  chosenOptionId: string;
  isCorrect: boolean;
  submittedAt: string;
};

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

/** A prior matched pair from earlier in the season. */
export type PriorPair = { a: string; b: string; weekIndex: number };

/** A prior bye (sit-out) for a player from earlier in the season. */
export type PriorBye = { playerId: string; weekIndex: number };

/** Input to the pairing engine for one week. */
export type PairingInput = {
  presentPlayerIds: string[];
  priorPairs: PriorPair[];
  priorByes: PriorBye[];
};

/** The output produced by `computePairing`. */
export type PairingResult = {
  pairs: [string, string][];
  byePlayerId: string | null;
  usedFallback: boolean;
};

// ---------------------------------------------------------------------------
// Scoring, leaderboard & history
// ---------------------------------------------------------------------------

export type LeaderboardScope = "season" | "all_time";

/** A score within a single leaderboard scope. */
export type ScopeScore = { total: number; correctGuesses: number };

/** A player's seeded standings across both leaderboard scopes. */
export type LeaderboardSeedRow = {
  playerId: string;
  season: ScopeScore;
  allTime: ScopeScore;
};

/** A materialized weekly score for one player after a week is closed. */
export type StoredWeeklyScore = {
  weekId: string;
  playerId: string;
  participation: number;
  correctGuesses: number;
  total: number;
};

/** A materialized head-to-head recap for one matchup after a week is closed. */
export type StoredMatchupRecap = {
  weekId: string;
  matchupId: string;
  correctByPlayer: Record<string, number>;
  questionCount: number;
};

/** One past week in a player's personal history. */
export type HistoryEntry = {
  weekId: string;
  /** ISO 8601 start date of the week; "" if unknown. */
  startsAt: string;
  opponentName: string;
  recap: Recap;
};

// ---------------------------------------------------------------------------
// Admin matchup overview
// ---------------------------------------------------------------------------

export type AdminMatchupStatus =
  | "awaiting_both"
  | "awaiting_one"
  | "guessing_unlocked";

export type AdminMatchupParticipant = {
  id: string;
  name: string;
  answered: boolean;
};

export type AdminMatchupRow = {
  matchupId: string;
  playerA: AdminMatchupParticipant;
  playerB: AdminMatchupParticipant;
  status: AdminMatchupStatus;
};

export type AdminWeekOverview = {
  weekId: string;
  /** ISO 8601 start date of the week; "" when there is no week. */
  startsAt: string;
  weekStatus: WeekStatus;
  matchups: AdminMatchupRow[];
  byePlayers: { id: string; name: string }[];
};
