/**
 * Game service (mock implementation).
 *
 * Derives a player's view of the current week (`MyWeekView`) from a static data
 * snapshot: roster, current week, matchups and byes. This is the seam the data
 * layer will later replace with real API calls — the contract is the
 * `GameService` interface.
 */

import type { FixtureMatchup } from "@/lib/fixtures";
import { computePairing } from "@/lib/pairing";
import { getMockStore } from "@/lib/mockStore";
import { resolveSlackIdByEmail } from "@/lib/slack";
import {
  DISTRACTOR_COUNT,
  defaultDistractorGenerator,
  defaultQuestionGenerator,
  type DistractorGenerator,
  type QuestionGenerator,
} from "@/lib/ai";
import {
  rankPlayers,
  scoreWeekForPlayer,
  type RankedRow,
  type ScoreRow,
} from "@/lib/scoring";
import type {
  AdminMatchupRow,
  AdminMatchupStatus,
  AdminWeekOverview,
  AnswerSubmission,
  GuessOption,
  GuessResult,
  GuessSheet,
  HistoryEntry,
  LeaderboardScope,
  LeaderboardSeedRow,
  MyWeekView,
  Player,
  Question,
  QuestionSuggestion,
  Recap,
  StoredAnswer,
  StoredAnswerOption,
  StoredGuess,
  StoredMatchupRecap,
  StoredSuggestion,
  StoredWeeklyScore,
  WeekStatus,
} from "@/lib/types";
import { WEEKLY_QUESTION_COUNT } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLOSED_STATUS: WeekStatus = "closed";
const OPEN_STATUS: WeekStatus = "open";
const AWAITING_STATUS: WeekStatus = "awaiting_approval";

/** Number of matchup participants whose answers unlock guessing. */
const PARTICIPANTS_REQUIRED_TO_UNLOCK = 2;

/**
 * Duration of one week in milliseconds. Used to derive the draft week's start
 * date (one week after the current week). Mirrors dbGameService.ONE_WEEK_MS.
 */
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Leaderboard scope selecting the season standings. */
const SEASON_SCOPE: LeaderboardScope = "season";

// ---------------------------------------------------------------------------
// Data shape
// ---------------------------------------------------------------------------

type GameServiceWeek = {
  id: string;
  /** ISO 8601 start date-time of the week; "" / absent when unknown. */
  startsAt?: string;
  status: WeekStatus;
  questions: Question[];
  /** Set by approveWeek() to the ISO timestamp of approval. */
  questionsApprovedAt?: string;
};

export type GameServiceData = {
  players: Player[];
  currentWeek: GameServiceWeek;
  matchups: FixtureMatchup[];
  byePlayerIds: string[];
  answers?: StoredAnswer[];
  answerOptions?: StoredAnswerOption[];
  guesses?: StoredGuess[];
  leaderboard?: LeaderboardSeedRow[];
  history?: Record<string, HistoryEntry[]>;
  weeklyScores?: StoredWeeklyScore[];
  recaps?: StoredMatchupRecap[];
  /**
   * A standing, week-agnostic pool of player-authored candidate questions.
   * Optional so existing scenarios that omit it continue to compile; when
   * absent, suggestQuestion lazily initialises it (`data.suggestions ??= []`).
   */
  suggestions?: StoredSuggestion[];
  /**
   * The ids of players present for the current week. When absent, all players
   * are treated as present. Consumed by openWeek().
   */
  presentPlayerIds?: string[];
  /**
   * Prior pairing history forwarded verbatim to computePairing(). Defaults to
   * empty arrays when absent.
   */
  pairingHistory?: {
    priorPairs: { a: string; b: string; weekIndex: number }[];
    priorByes: { playerId: string; weekIndex: number }[];
  };
  /**
   * The pending draft week created by getDraftQuestions() and promoted to
   * currentWeek by approveWeek(). Absent until the first getDraftQuestions call.
   */
  draftWeek?: {
    id: string;
    /** ISO 8601 start date of the draft week; used to label the questions screen. */
    startsAt?: string;
    status: WeekStatus;
    questions: Question[];
    questionsApprovedAt?: string;
  };
  /**
   * Maps a weekId to the array of player ids flagged absent for that week.
   * When absent from the record (or the key is missing) the week has no
   * recorded absences. Optional so existing scenarios that omit it continue
   * to compile and behave correctly.
   */
  weekAbsences?: Record<string, string[]>;
};

/** Injectable collaborators, defaulted for the standard mock instance. */
export type GameServiceDeps = {
  /**
   * Distractor generator. Defaults to the Gemini-backed generator, which itself
   * falls back to the deterministic stub when no GEMINI_API_KEY is set.
   */
  distractors?: DistractorGenerator;
  /**
   * Question generator for admin draft-week flow. Defaults to the Gemini-backed
   * generator, which falls back to the deterministic stub when no key is set.
   */
  questions?: QuestionGenerator;
  now?: () => string;
  shuffle?: <T>(items: T[]) => T[];
};

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface GameService {
  getMyWeek(playerId: string): Promise<MyWeekView>;
  submitAnswers(
    playerId: string,
    weekId: string,
    answers: AnswerSubmission[],
  ): Promise<void>;
  /**
   * Idempotently generate + persist the AI answer options for the player's
   * answers this week. Safe to call repeatedly and concurrently (no duplicates).
   * Split out of submitAnswers so submitting is instant; run in the background
   * after submit and lazily on guess-sheet read.
   */
  ensureAnswerOptions(playerId: string, weekId: string): Promise<void>;
  getGuessSheet(playerId: string, weekId: string): Promise<GuessSheet>;
  submitGuess(
    playerId: string,
    weekId: string,
    questionId: string,
    chosenOptionId: string,
  ): Promise<GuessResult>;
  getLeaderboard(scope: LeaderboardScope): Promise<RankedRow[]>;
  closeWeek(weekId: string): Promise<void>;
  openWeek(weekId: string): Promise<void>;
  getMyHistory(playerId: string): Promise<HistoryEntry[]>;
  /** Admin: create or return the draft questions for a given upcoming week id. */
  getDraftQuestions(weekId: string): Promise<Question[]>;
  /** Admin: edit one draft question text (trims; throws on blank or unknown id). */
  updateDraftQuestion(questionId: string, text: string): Promise<Question[]>;
  /** Admin: replace one draft question with a freshly generated prompt. */
  regenerateQuestion(questionId: string): Promise<Question[]>;
  /** Admin: approve the draft week, run pairing, and promote to currentWeek. */
  approveWeek(weekId: string): Promise<void>;
  /** Admin: revert the current OPEN week to questions-review (awaiting_approval), wiping all play (answers, options, guesses, scores, recaps) and clearing matchups/byes. The admin then edits/keeps questions and re-approves, which re-pairs with the current active roster (picking up new players). Throws if weekId is not the current open week. */
  restartWeek(weekId: string): Promise<void>;
  /** Admin: return the current week's matchups and status for the admin overview. */
  getAdminMatchups(): Promise<AdminWeekOverview>;
  /** Admin: the current draft week's id + ISO start date for labeling the questions screen; null if no draft exists. */
  getDraftWeekInfo(): Promise<{ weekId: string; startsAt: string } | null>;
  /** Admin: return all players (active and inactive). */
  listRoster(): Promise<Player[]>;
  /** Admin: add a new player or update an existing one by id. Returns full roster. */
  upsertPlayer(player: Player): Promise<Player[]>;
  /** Admin: set active===false for the given player id. Throws on unknown id. Returns full roster. */
  deactivatePlayer(playerId: string): Promise<Player[]>;
  /** Admin: record absent player ids for a week. Throws if the week is already open or closed. */
  setWeekAbsences(weekId: string, absentPlayerIds: string[]): Promise<void>;
  /** Admin: return the active-minus-absent players for a given week as Player objects. */
  getPresentPlayers(weekId: string): Promise<Player[]>;
  /** Admin: resolve missing Slack user ids for active players via email lookup; persists them. Returns how many were updated. */
  backfillSlackIds(): Promise<{ updated: number }>;
  /** Player: append a trimmed question to the standing suggestion pool. Throws on empty/whitespace-only text. Week-agnostic. */
  suggestQuestion(playerId: string, text: string): Promise<void>;
  /** Admin: return the standing suggestion pool newest-first, each with the suggester's resolved name. */
  listSuggestions(): Promise<QuestionSuggestion[]>;
  /**
   * Admin: copy a suggestion's text into the draft slot identified by
   * `draftQuestionId`, hard-delete the suggestion, and return the updated draft
   * questions (same shape as `updateDraftQuestion`). Throws on unknown
   * suggestion id, unknown draft question id, or absent draft week — making no
   * mutation until all guards pass.
   */
  useSuggestion(
    suggestionId: string,
    draftQuestionId: string,
  ): Promise<Question[]>;
  /** Admin: hard-delete a suggestion from the pool. No draft change. Throws on unknown id. */
  removeSuggestion(suggestionId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Shared validation
// ---------------------------------------------------------------------------

/** Message thrown when a suggestion's text is empty or whitespace-only. */
export const EMPTY_SUGGESTION_MESSAGE = "Suggestion text is required.";

// ---------------------------------------------------------------------------
// Default shuffle
// ---------------------------------------------------------------------------

/** Fisher–Yates shuffle over a copy, using Math.random. */
const defaultShuffle = <T>(items: T[]): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

// ---------------------------------------------------------------------------
// Derivation helpers
// ---------------------------------------------------------------------------

const sortByOrderIndex = (questions: Question[]): Question[] =>
  [...questions].sort((a, b) => a.orderIndex - b.orderIndex);

const findMatchup = (
  matchups: FixtureMatchup[],
  playerId: string,
): FixtureMatchup | undefined =>
  matchups.find(
    (m) => m.playerAId === playerId || m.playerBId === playerId,
  );

const resolveOpponentId = (
  matchup: FixtureMatchup,
  playerId: string,
): string =>
  matchup.playerAId === playerId ? matchup.playerBId : matchup.playerAId;

/**
 * Builds a deterministic recap from the answered set. The mock has no scoring
 * engine, so "correct" counts mirror who actually answered — enough to render a
 * coherent recap card once the week is closed.
 */
const buildRecap = (
  matchup: FixtureMatchup,
  playerId: string,
  opponentId: string,
  questionCount: number,
): Recap => ({
  meCorrect: matchup.answeredBy.includes(playerId) ? questionCount : 0,
  opponentCorrect: matchup.answeredBy.includes(opponentId) ? questionCount : 0,
  questionCount,
});

/**
 * Validates that the submission set exactly covers the week's questions: one
 * answer per question, no unknown ids, no duplicates, all texts non-empty.
 * Throws on the first violation so the caller surfaces a clear failure.
 */
const assertValidAnswerSet = (
  questions: Question[],
  answers: AnswerSubmission[],
): void => {
  if (answers.length !== questions.length) {
    throw new Error(
      `Expected ${questions.length} answers, received ${answers.length}.`,
    );
  }

  const questionIds = new Set(questions.map((question) => question.id));
  const seen = new Set<string>();

  for (const answer of answers) {
    if (!questionIds.has(answer.questionId)) {
      throw new Error(`Unknown question id "${answer.questionId}".`);
    }
    if (seen.has(answer.questionId)) {
      throw new Error(`Duplicate answer for question "${answer.questionId}".`);
    }
    if (answer.text.trim().length === 0) {
      throw new Error(`Answer for question "${answer.questionId}" is empty.`);
    }
    seen.add(answer.questionId);
  }
};

/**
 * Builds the four options for one stored answer: the real answer first (correct)
 * followed by the generated distractors (incorrect).
 */
const buildAnswerOptions = (
  answerId: string,
  realText: string,
  distractors: string[],
): StoredAnswerOption[] => [
  { id: `${answerId}-opt-0`, text: realText, isCorrect: true, answerId },
  ...distractors.map((text, index) => ({
    id: `${answerId}-opt-${index + 1}`,
    text,
    isCorrect: false,
    answerId,
  })),
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createMockGameService = (
  data: GameServiceData,
  deps: GameServiceDeps = {},
): GameService => {
  const distractorGenerator = deps.distractors ?? defaultDistractorGenerator;
  const questionGenerator = deps.questions ?? defaultQuestionGenerator;
  const now = deps.now ?? (() => new Date().toISOString());
  const shuffle = deps.shuffle ?? defaultShuffle;

  /**
   * Monotonic sequence scoped to this factory closure for minting suggestion
   * ids. A length-based scheme could reuse a value after a removal (add → remove
   * → add would collide), so this counter — which only ever increments — keeps
   * ids distinct across the full add/remove lifecycle.
   */
  let suggestionSeq = 0;

  // ---------------------------------------------------------------------------
  // Shared pairing helper (reused by openWeek and approveWeek)
  // ---------------------------------------------------------------------------

  /**
   * Returns the ids of players eligible to be paired for `weekId`: active
   * players who are not flagged absent in weekAbsences for that week.
   * This is the single source of truth for the active-minus-absent rule —
   * both buildPairingForWeek (when presentPlayerIds override is absent) and
   * getPresentPlayers delegate to this helper so the filter is never duplicated.
   */
  const resolvePresentPlayerIds = (weekId: string): string[] => {
    const absent = new Set(data.weekAbsences?.[weekId] ?? []);
    return data.players
      .filter((p) => p.active === true && !absent.has(p.id))
      .map((p) => p.id);
  };

  /**
   * Resolves present player ids, runs computePairing, and returns the matchups
   * and byePlayerIds arrays for `weekId`. Extracted to eliminate duplication
   * between openWeek and approveWeek (CLAUDE.md DRY rule).
   */
  const buildPairingForWeek = (weekId: string): {
    matchups: FixtureMatchup[];
    byePlayerIds: string[];
  } => {
    const presentPlayerIds =
      data.presentPlayerIds ?? resolvePresentPlayerIds(weekId);

    const priorPairs = data.pairingHistory?.priorPairs ?? [];
    const priorByes = data.pairingHistory?.priorByes ?? [];

    const result = computePairing({ presentPlayerIds, priorPairs, priorByes });

    const matchups: FixtureMatchup[] = result.pairs.map(([playerAId, playerBId]) => ({
      id: `matchup-${weekId}-${playerAId}-${playerBId}`,
      weekId,
      playerAId,
      playerBId,
      answeredBy: [],
    }));

    const byePlayerIds: string[] = result.byePlayerId !== null
      ? [result.byePlayerId]
      : [];

    return { matchups, byePlayerIds };
  };

  // --- Shared guard: resolve a paired, unlocked player or throw ----------
  const requireUnlockedMatchup = (
    playerId: string,
    weekId: string,
  ): { matchup: FixtureMatchup; opponentId: string } => {
    const { currentWeek, matchups, byePlayerIds } = data;

    if (weekId !== currentWeek.id) {
      throw new Error(`Week "${weekId}" is not the current week.`);
    }
    if (byePlayerIds.includes(playerId)) {
      throw new Error(`Player "${playerId}" is on a bye this week.`);
    }
    const matchup = findMatchup(matchups, playerId);
    if (!matchup) {
      throw new Error(`No matchup found for player "${playerId}" this week.`);
    }
    if (matchup.answeredBy.length < PARTICIPANTS_REQUIRED_TO_UNLOCK) {
      throw new Error(`Guessing is not unlocked for player "${playerId}".`);
    }
    return { matchup, opponentId: resolveOpponentId(matchup, playerId) };
  };

  const getMyWeek = async (playerId: string): Promise<MyWeekView> => {
    const { currentWeek, matchups, byePlayerIds } = data;
    const questions = sortByOrderIndex(currentWeek.questions);
    const isClosed = currentWeek.status === CLOSED_STATUS;

    // --- Bye: the player sits out this week -------------------------------
    if (byePlayerIds.includes(playerId)) {
      return {
        weekId: currentWeek.id,
        startsAt: currentWeek.startsAt ?? "",
        status: currentWeek.status,
        opponent: null,
        isBye: true,
        questions,
        myAnswersSubmitted: false,
        opponentAnswered: false,
        guessingUnlocked: false,
        guessingComplete: false,
        myCorrectGuesses: 0,
      };
    }

    // --- Paired: resolve the opponent from either side --------------------
    const matchup = findMatchup(matchups, playerId);
    if (!matchup) {
      // No matchup/bye and the week is NOT open (e.g. pre-pairing after a
      // restart): return a graceful pre-pairing view rather than throwing.
      // Mirrors dbGameService.getMyWeek. A missing matchup while the week IS
      // open remains a real data-integrity error.
      if (currentWeek.status !== OPEN_STATUS) {
        return {
          weekId: currentWeek.id,
          startsAt: currentWeek.startsAt ?? "",
          status: currentWeek.status,
          opponent: null,
          isBye: false,
          questions,
          myAnswersSubmitted: false,
          opponentAnswered: false,
          guessingUnlocked: false,
          guessingComplete: false,
          myCorrectGuesses: 0,
        };
      }
      throw new Error(
        `No matchup or bye found for player "${playerId}" this week.`,
      );
    }

    const opponentId = resolveOpponentId(matchup, playerId);
    const opponent =
      data.players.find((p) => p.id === opponentId) ?? null;

    const myAnswersSubmitted = matchup.answeredBy.includes(playerId);
    const opponentAnswered = matchup.answeredBy.includes(opponentId);
    const guessingUnlocked =
      matchup.answeredBy.length >= PARTICIPANTS_REQUIRED_TO_UNLOCK;

    // Guessing is complete once the player has a guess for every question.
    const playerGuessCount = (data.guesses ?? []).filter(
      (guess) => guess.guesserId === playerId && guess.matchupId === matchup.id,
    ).length;
    const guessingComplete =
      guessingUnlocked && playerGuessCount >= questions.length;

    // The player's week score: how many of their guesses were correct.
    const myCorrectGuesses = (data.guesses ?? []).filter(
      (guess) =>
        guess.guesserId === playerId &&
        guess.matchupId === matchup.id &&
        guess.isCorrect === true,
    ).length;

    const view: MyWeekView = {
      weekId: currentWeek.id,
      startsAt: currentWeek.startsAt ?? "",
      status: currentWeek.status,
      opponent,
      isBye: false,
      questions,
      myAnswersSubmitted,
      opponentAnswered,
      guessingUnlocked,
      guessingComplete,
      myCorrectGuesses,
    };

    if (isClosed) {
      view.recap = buildRecap(
        matchup,
        playerId,
        opponentId,
        questions.length,
      );
    }

    return view;
  };

  const submitAnswers = async (
    playerId: string,
    weekId: string,
    answers: AnswerSubmission[],
  ): Promise<void> => {
    const { currentWeek, matchups, byePlayerIds } = data;

    // --- Week guards ------------------------------------------------------
    if (weekId !== currentWeek.id) {
      throw new Error(`Week "${weekId}" is not the current week.`);
    }
    if (currentWeek.status !== OPEN_STATUS) {
      throw new Error("The current week is not open for answers.");
    }

    // --- Eligibility guards ----------------------------------------------
    if (byePlayerIds.includes(playerId)) {
      throw new Error(`Player "${playerId}" is on a bye this week.`);
    }
    const matchup = findMatchup(matchups, playerId);
    if (!matchup) {
      throw new Error(`No matchup found for player "${playerId}" this week.`);
    }

    // --- Double-submission guard -----------------------------------------
    if (matchup.answeredBy.includes(playerId)) {
      throw new Error(`Player "${playerId}" has already submitted.`);
    }

    // --- Answer-set validation -------------------------------------------
    assertValidAnswerSet(currentWeek.questions, answers);

    // --- Persist answers only (fast submit path) -------------------------
    // Option generation is now off the submit path: it runs in the background
    // via ensureAnswerOptions (and lazily on guess-sheet read) so submitting
    // stays instant. No AI round-trips happen here.
    const storedAnswers = (data.answers ??= []);

    answers.forEach((answer) => {
      const answerId = `answer-${matchup.id}-${playerId}-${answer.questionId}`;
      storedAnswers.push({
        id: answerId,
        matchupId: matchup.id,
        questionId: answer.questionId,
        playerId,
        text: answer.text,
      });
    });

    // --- Mark answered; unlock guessing once both have answered ----------
    matchup.answeredBy.push(playerId);
    if (matchup.answeredBy.length >= PARTICIPANTS_REQUIRED_TO_UNLOCK) {
      matchup.guessingUnlockedAt = now();
    }
  };

  // --- Ensure answer options: idempotent, concurrency-safe generation ----
  const ensureAnswerOptions = async (
    playerId: string,
    weekId: string,
  ): Promise<void> => {
    const { currentWeek, matchups } = data;

    if (weekId !== currentWeek.id) {
      return;
    }

    // Resolve the player's matchup (submitter's matchup need not be unlocked).
    const matchup = findMatchup(matchups, playerId);
    if (!matchup) {
      return;
    }

    const storedOptions = (data.answerOptions ??= []);
    const playerAnswers = (data.answers ?? []).filter(
      (answer) =>
        answer.matchupId === matchup.id && answer.playerId === playerId,
    );

    // Only generate for answers that currently have NO options persisted.
    const pending = playerAnswers.filter(
      (answer) =>
        !storedOptions.some((option) => option.answerId === answer.id),
    );
    if (pending.length === 0) {
      return;
    }

    // Generate distractors for the pending answers CONCURRENTLY: the AI
    // round-trips dominate latency, so Promise.all collapses N sequential
    // awaits into roughly one call's worth of wall-clock.
    const optionSets = await Promise.all(
      pending.map(async (answer) => {
        const question = currentWeek.questions.find(
          (candidate) => candidate.id === answer.questionId,
        );
        const distractors = await distractorGenerator.generateDistractors(
          question?.text ?? answer.questionId,
          answer.text,
        );
        return buildAnswerOptions(
          answer.id,
          answer.text,
          distractors.slice(0, DISTRACTOR_COUNT),
        );
      }),
    );

    // IDEMPOTENT + CONCURRENCY-SAFE: drop any option whose deterministic id is
    // already present (another overlapping call may have persisted it), then
    // push only the new ids. Deterministic ids (`${answerId}-opt-N`) mean two
    // overlapping generations net exactly one set once already-present ids are
    // filtered out.
    for (const options of optionSets) {
      for (const option of options) {
        if (!storedOptions.some((existing) => existing.id === option.id)) {
          storedOptions.push(option);
        }
      }
    }
  };

  // --- Guess sheet: opponent's options per question, isCorrect stripped --
  const getGuessSheet = async (
    playerId: string,
    weekId: string,
  ): Promise<GuessSheet> => {
    const { matchup, opponentId } = requireUnlockedMatchup(playerId, weekId);

    // Lazy backstop: make sure the opponent's options exist before reading.
    await ensureAnswerOptions(opponentId, weekId);
    const questions = sortByOrderIndex(data.currentWeek.questions);
    const answers = data.answers ?? [];
    const answerOptions = data.answerOptions ?? [];
    const guesses = data.guesses ?? [];

    return questions.map((question) => {
      const answer = answers.find(
        (candidate) =>
          candidate.playerId === opponentId &&
          candidate.questionId === question.id,
      );
      const rawOptions = answer
        ? answerOptions.filter((option) => option.answerId === answer.id)
        : [];
      const options: GuessOption[] = shuffle(rawOptions).map((option) => ({
        id: option.id,
        text: option.text,
      }));

      // The opponent's stored answer text IS the real answer for this question.
      const priorGuess = guesses.find(
        (guess) =>
          guess.guesserId === playerId &&
          guess.matchupId === matchup.id &&
          guess.questionId === question.id,
      );
      const result: GuessResult | null =
        priorGuess && answer
          ? {
              questionId: question.id,
              correct: priorGuess.isCorrect,
              realAnswerText: answer.text,
            }
          : null;

      return {
        questionId: question.id,
        questionText: question.text,
        options,
        result,
      };
    });
  };

  // --- Submit one guess: score it, persist it, reveal the real answer ----
  const submitGuess = async (
    playerId: string,
    weekId: string,
    questionId: string,
    chosenOptionId: string,
  ): Promise<GuessResult> => {
    const { matchup, opponentId } = requireUnlockedMatchup(playerId, weekId);

    // Lazy backstop: ensure the opponent's options exist before validating.
    await ensureAnswerOptions(opponentId, weekId);

    const question = data.currentWeek.questions.find(
      (candidate) => candidate.id === questionId,
    );
    if (!question) {
      throw new Error(`Unknown question id "${questionId}".`);
    }

    const answer = (data.answers ?? []).find(
      (candidate) =>
        candidate.playerId === opponentId &&
        candidate.questionId === questionId,
    );
    const options = answer
      ? (data.answerOptions ?? []).filter(
          (option) => option.answerId === answer.id,
        )
      : [];
    const chosenOption = options.find((option) => option.id === chosenOptionId);
    if (!chosenOption || !answer) {
      throw new Error(
        `Invalid option "${chosenOptionId}" for question "${questionId}".`,
      );
    }

    const guesses = (data.guesses ??= []);
    const alreadyGuessed = guesses.some(
      (guess) =>
        guess.guesserId === playerId && guess.questionId === questionId,
    );
    if (alreadyGuessed) {
      throw new Error(`Question "${questionId}" has already been guessed.`);
    }

    const correct = chosenOption.isCorrect;
    guesses.push({
      id: `guess-${matchup.id}-${playerId}-${questionId}`,
      matchupId: matchup.id,
      questionId,
      guesserId: playerId,
      chosenOptionId,
      isCorrect: correct,
      submittedAt: now(),
    });

    return { questionId, correct, realAnswerText: answer.text };
  };

  // --- Leaderboard: rank seeded standings for the requested scope --------
  const getLeaderboard = async (
    scope: LeaderboardScope,
  ): Promise<RankedRow[]> => {
    const seed = data.leaderboard ?? [];
    const rows: ScoreRow[] = seed.map((row) => {
      const scopeScore = scope === SEASON_SCOPE ? row.season : row.allTime;
      const player = data.players.find((p) => p.id === row.playerId);
      return {
        playerId: row.playerId,
        name: player?.name ?? row.playerId,
        total: scopeScore.total,
        correctGuesses: scopeScore.correctGuesses,
      };
    });
    return rankPlayers(rows);
  };

  // --- Close the week: materialize weekly scores and matchup recaps ------
  const closeWeek = async (weekId: string): Promise<void> => {
    const { currentWeek, matchups, byePlayerIds } = data;

    if (weekId !== currentWeek.id) {
      throw new Error(`Week "${weekId}" is not the current week.`);
    }

    currentWeek.status = CLOSED_STATUS;

    const weeklyScores = (data.weeklyScores ??= []);
    const recaps = (data.recaps ??= []);
    const guesses = data.guesses ?? [];
    const questionCount = currentWeek.questions.length;

    const countCorrect = (playerId: string): number =>
      guesses.filter(
        (guess) => guess.guesserId === playerId && guess.isCorrect === true,
      ).length;

    const scoreParticipant = (
      matchup: FixtureMatchup,
      playerId: string,
    ): number => {
      const correctGuesses = countCorrect(playerId);
      const score = scoreWeekForPlayer({
        submittedOwnAnswers: matchup.answeredBy.includes(playerId),
        correctGuesses,
        isBye: false,
      });
      weeklyScores.push({
        weekId,
        playerId,
        participation: score.participation,
        correctGuesses: score.correctGuesses,
        total: score.total,
      });
      return correctGuesses;
    };

    for (const matchup of matchups) {
      const aCorrect = scoreParticipant(matchup, matchup.playerAId);
      const bCorrect = scoreParticipant(matchup, matchup.playerBId);
      recaps.push({
        weekId,
        matchupId: matchup.id,
        correctByPlayer: {
          [matchup.playerAId]: aCorrect,
          [matchup.playerBId]: bCorrect,
        },
        questionCount,
      });
    }

    for (const byePlayerId of byePlayerIds) {
      const score = scoreWeekForPlayer({
        submittedOwnAnswers: false,
        correctGuesses: 0,
        isBye: true,
      });
      weeklyScores.push({
        weekId,
        playerId: byePlayerId,
        participation: score.participation,
        correctGuesses: score.correctGuesses,
        total: score.total,
      });
    }
  };

  // --- Open the week: run the pairing engine and populate matchups/byes ---
  const openWeek = async (weekId: string): Promise<void> => {
    const { currentWeek } = data;

    if (weekId !== currentWeek.id) {
      throw new Error(`Week "${weekId}" is not the current week.`);
    }

    const { matchups, byePlayerIds } = buildPairingForWeek(weekId);

    // Populate matchups in place (consistent with how submitAnswers mutates data).
    for (const matchup of matchups) {
      data.matchups.push(matchup);
    }

    // Populate bye (empty array when no bye).
    for (const byeId of byePlayerIds) {
      data.byePlayerIds.push(byeId);
    }
  };

  // --- Admin: create or return the draft questions for an upcoming week ------
  const getDraftQuestions = async (weekId: string): Promise<Question[]> => {
    // Idempotent: return existing draft if same weekId.
    if (data.draftWeek && data.draftWeek.id === weekId) {
      return sortByOrderIndex(data.draftWeek.questions);
    }

    // Generate fresh questions for this week (different weekId replaces draft).
    const texts = await questionGenerator.generateQuestions(WEEKLY_QUESTION_COUNT);
    const questions: Question[] = texts.map((text, i) => ({
      id: `draft-${weekId}-q${i}`,
      orderIndex: i,
      text,
    }));

    // The draft week starts one week after the current week so the questions
    // screen can name it. Fall back to "now" when the current week has no date.
    const currentStartsAt = data.currentWeek.startsAt;
    const draftStartsAt = currentStartsAt
      ? new Date(new Date(currentStartsAt).getTime() + ONE_WEEK_MS).toISOString()
      : new Date().toISOString();

    data.draftWeek = {
      id: weekId,
      startsAt: draftStartsAt,
      status: "awaiting_approval",
      questions,
    };

    return sortByOrderIndex(questions);
  };

  // --- Admin: edit one draft question text -----------------------------------
  const updateDraftQuestion = async (
    questionId: string,
    text: string,
  ): Promise<Question[]> => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new Error("Question text must not be empty or whitespace-only.");
    }

    if (!data.draftWeek) {
      throw new Error("No draft week exists. Call getDraftQuestions first.");
    }

    const question = data.draftWeek.questions.find((q) => q.id === questionId);
    if (!question) {
      throw new Error(`Unknown draft question id "${questionId}".`);
    }

    question.text = trimmed;

    return sortByOrderIndex(data.draftWeek.questions);
  };

  // --- Admin: replace one draft question with a freshly generated prompt -----

  /**
   * Number of candidates to request from the generator when regenerating a
   * single slot. Requesting a generous count (well beyond the draft size)
   * ensures the full canned pool is returned when the pool size equals or
   * exceeds this value, giving plenty of distinct options to pick from.
   */
  const REGENERATE_CANDIDATE_COUNT = WEEKLY_QUESTION_COUNT * 3;

  const regenerateQuestion = async (questionId: string): Promise<Question[]> => {
    if (!data.draftWeek) {
      throw new Error("No draft week exists. Call getDraftQuestions first.");
    }

    const question = data.draftWeek.questions.find((q) => q.id === questionId);
    if (!question) {
      throw new Error(`Unknown draft question id "${questionId}".`);
    }

    const currentText = question.text;

    // Build a set of texts currently held by all OTHER draft slots so the
    // replacement is distinct from all occupied slots, not just the current one.
    const otherDraftTexts = new Set(
      data.draftWeek.questions
        .filter((q) => q.id !== questionId)
        .map((q) => q.text),
    );

    // Request a generous candidate pool so the generator can return its full
    // canned list even when pool size <= REGENERATE_CANDIDATE_COUNT.
    const candidates = await questionGenerator.generateQuestions(
      REGENERATE_CANDIDATE_COUNT,
    );

    // Prefer the first candidate that is absent from ALL current draft slots
    // (i.e., not the current text and not held by any other slot).
    // Graceful fallback: if every candidate is already used elsewhere, accept
    // any candidate that at least differs from the current slot's own text.
    const fresh =
      candidates.find((c) => c !== currentText && !otherDraftTexts.has(c)) ??
      candidates.find((c) => c !== currentText);

    if (fresh !== undefined) {
      question.text = fresh;
    }

    return sortByOrderIndex(data.draftWeek.questions);
  };

  // --- Admin: approve the draft week, run pairing, promote to currentWeek ---
  const approveWeek = async (weekId: string): Promise<void> => {
    // Idempotent guard: already open, nothing to do.
    if (
      data.currentWeek.id === weekId &&
      data.currentWeek.status === OPEN_STATUS
    ) {
      return;
    }

    if (!data.draftWeek || data.draftWeek.id !== weekId) {
      throw new Error(
        `No draft week with id "${weekId}" found. Call getDraftQuestions first.`,
      );
    }

    // Stamp approval time.
    data.draftWeek.questionsApprovedAt = now();

    // Run pairing over present players.
    const { matchups, byePlayerIds } = buildPairingForWeek(weekId);

    // Promote draft → currentWeek (replace, not append). Carry the prior week's
    // startsAt forward when present; the draft week itself has no start date.
    data.currentWeek = {
      id: weekId,
      startsAt: data.currentWeek.startsAt ?? "",
      status: OPEN_STATUS,
      questions: data.draftWeek.questions,
      questionsApprovedAt: data.draftWeek.questionsApprovedAt,
    };

    // Replace matchups and byes with the freshly computed results.
    data.matchups = matchups;
    data.byePlayerIds = byePlayerIds;
  };

  // --- Admin: restart the current open week back to questions-review --------

  /**
   * Reverts the current OPEN week to the questions-review (awaiting_approval)
   * state and wipes all play so the admin can edit/keep questions and
   * re-approve (which re-pairs over the live active roster, picking up new
   * players). The week's questions are preserved verbatim — the generator is
   * NOT consulted. Throws if weekId is not the current open week.
   */
  const restartWeek = async (weekId: string): Promise<void> => {
    const { currentWeek } = data;

    // --- Guard: only the current open week can be restarted ---------------
    if (weekId !== currentWeek.id || currentWeek.status !== OPEN_STATUS) {
      throw new Error(
        `Only the current open week can be restarted; week "${weekId}" is not open.`,
      );
    }

    // --- Revert the week to review and re-seed the draft slot -------------
    // Cloning the questions into draftWeek lets the existing
    // getDraftQuestions/approveWeek path drive the re-pair+promote without
    // regenerating any question text.
    currentWeek.status = AWAITING_STATUS;
    currentWeek.questionsApprovedAt = undefined;
    data.draftWeek = {
      id: currentWeek.id,
      status: AWAITING_STATUS,
      questions: currentWeek.questions.map((q) => ({ ...q })),
    };

    // --- Wipe all play + pairing for the (single) current week ------------
    // The mock has one current week, so its play arrays are wholly week-scoped:
    // clearing them outright is equivalent to filtering by this week.
    data.matchups = [];
    data.byePlayerIds = [];
    data.answers = [];
    data.answerOptions = [];
    data.guesses = [];
    data.weeklyScores = [];
    data.recaps = [];

    // Clear presence so re-approval pairs from the live active roster.
    data.presentPlayerIds = undefined;
  };

  // ---------------------------------------------------------------------------
  // Admin: Matchup overview
  // ---------------------------------------------------------------------------

  /** Resolve a player's display name from the roster, falling back to the id. */
  const resolvePlayerName = (id: string): string =>
    data.players.find((p) => p.id === id)?.name ?? id;

  /** Derive the matchup status from the number of recorded answers. */
  const deriveMatchupStatus = (answeredByLength: number): AdminMatchupStatus => {
    if (answeredByLength >= PARTICIPANTS_REQUIRED_TO_UNLOCK) {
      return "guessing_unlocked";
    }
    if (answeredByLength === 1) {
      return "awaiting_one";
    }
    return "awaiting_both";
  };

  const getAdminMatchups = async (): Promise<AdminWeekOverview> => {
    const { currentWeek, matchups, byePlayerIds } = data;

    const matchupRows: AdminMatchupRow[] = matchups.map((matchup) => ({
      matchupId: matchup.id,
      playerA: {
        id: matchup.playerAId,
        name: resolvePlayerName(matchup.playerAId),
        answered: matchup.answeredBy.includes(matchup.playerAId),
      },
      playerB: {
        id: matchup.playerBId,
        name: resolvePlayerName(matchup.playerBId),
        answered: matchup.answeredBy.includes(matchup.playerBId),
      },
      status: deriveMatchupStatus(matchup.answeredBy.length),
    }));

    const byePlayers = byePlayerIds.map((id) => ({
      id,
      name: resolvePlayerName(id),
    }));

    return {
      weekId: currentWeek.id,
      startsAt: currentWeek.startsAt ?? "",
      weekStatus: currentWeek.status,
      matchups: matchupRows,
      byePlayers,
    };
  };

  /** Admin: the draft week's id + start date for the questions screen label. */
  const getDraftWeekInfo = async (): Promise<
    { weekId: string; startsAt: string } | null
  > =>
    data.draftWeek
      ? { weekId: data.draftWeek.id, startsAt: data.draftWeek.startsAt ?? "" }
      : null;

  // ---------------------------------------------------------------------------
  // Admin: Roster & Absences (slice 07)
  // ---------------------------------------------------------------------------

  // --- Roster: return all players (active and inactive) --------------------
  const listRoster = async (): Promise<Player[]> => data.players;

  // --- Roster: add or update a player by id --------------------------------
  const upsertPlayer = async (player: Player): Promise<Player[]> => {
    const index = data.players.findIndex((p) => p.id === player.id);
    if (index !== -1) {
      // Update in place — mutate the existing object's fields.
      Object.assign(data.players[index], player);
    } else {
      data.players.push(player);
    }
    return data.players;
  };

  // --- Roster: set active===false for a player (throws on unknown id) ------
  const deactivatePlayer = async (playerId: string): Promise<Player[]> => {
    const player = data.players.find((p) => p.id === playerId);
    if (!player) {
      throw new Error(
        `Cannot deactivate: player with id "${playerId}" does not exist.`,
      );
    }
    player.active = false;
    return data.players;
  };

  // --- Absences: record absent player ids for a week -----------------------
  const setWeekAbsences = async (
    weekId: string,
    absentPlayerIds: string[],
  ): Promise<void> => {
    // Guard: absences cannot be changed once the week is open or closed.
    if (
      data.currentWeek.id === weekId &&
      (data.currentWeek.status === OPEN_STATUS ||
        data.currentWeek.status === CLOSED_STATUS)
    ) {
      throw new Error(
        `Cannot set absences for week "${weekId}": week is already ${data.currentWeek.status}.`,
      );
    }
    (data.weekAbsences ??= {})[weekId] = [...absentPlayerIds];
  };

  // --- Absences: return active-minus-absent players as Player objects -------
  const getPresentPlayers = async (weekId: string): Promise<Player[]> => {
    const presentIds = new Set(resolvePresentPlayerIds(weekId));
    return data.players.filter((p) => presentIds.has(p.id));
  };

  // --- Roster: resolve missing Slack user ids for active players -----------
  const backfillSlackIds = async (): Promise<{ updated: number }> => {
    let updated = 0;
    for (const player of data.players) {
      if (!player.active || player.slackUserId) {
        continue;
      }
      const id = await resolveSlackIdByEmail(player.email);
      if (id) {
        player.slackUserId = id;
        updated += 1;
      }
    }
    return { updated };
  };

  // ---------------------------------------------------------------------------
  // Player: suggest a question (standing, week-agnostic pool)
  // ---------------------------------------------------------------------------

  const suggestQuestion = async (
    playerId: string,
    text: string,
  ): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new Error(EMPTY_SUGGESTION_MESSAGE);
    }

    const suggestions = (data.suggestions ??= []);
    // Ids come from a monotonic counter so successive appends stay distinct
    // even when the injected now() clock is constant across calls, and — unlike
    // a length-based scheme — never collide after a removal frees up a length.
    suggestions.push({
      id: `suggestion-${suggestionSeq++}-${now()}`,
      text: trimmed,
      suggestedById: playerId,
      createdAt: now(),
    });
  };

  // ---------------------------------------------------------------------------
  // Admin: use / remove a suggestion (write paths into the draft slot / pool)
  // ---------------------------------------------------------------------------

  /**
   * Copies a suggestion's text into a chosen draft slot, then hard-deletes the
   * suggestion. Validates ALL preconditions before mutating anything so a
   * rejected call leaves both the pool and the draft untouched. Reuses the same
   * draft-slot lookup as updateDraftQuestion so the two stay consistent.
   */
  const useSuggestion = async (
    suggestionId: string,
    draftQuestionId: string,
  ): Promise<Question[]> => {
    const suggestions = data.suggestions ?? [];
    const suggestionIndex = suggestions.findIndex((s) => s.id === suggestionId);
    if (suggestionIndex === -1) {
      throw new Error(`Unknown suggestion id "${suggestionId}".`);
    }

    if (!data.draftWeek) {
      throw new Error("No draft week exists. Call getDraftQuestions first.");
    }

    const question = data.draftWeek.questions.find(
      (q) => q.id === draftQuestionId,
    );
    if (!question) {
      throw new Error(`Unknown draft question id "${draftQuestionId}".`);
    }

    // All guards passed — now mutate: snapshot the text into the slot, then
    // hard-delete the consumed suggestion.
    question.text = suggestions[suggestionIndex].text;
    suggestions.splice(suggestionIndex, 1);

    return sortByOrderIndex(data.draftWeek.questions);
  };

  /**
   * Hard-deletes a suggestion from the pool without touching the draft week.
   * Throws (making no mutation) when the id matches nothing.
   */
  const removeSuggestion = async (suggestionId: string): Promise<void> => {
    const suggestions = data.suggestions ?? [];
    const index = suggestions.findIndex((s) => s.id === suggestionId);
    if (index === -1) {
      throw new Error(`Unknown suggestion id "${suggestionId}".`);
    }
    suggestions.splice(index, 1);
  };

  // --- Admin: read the standing pool newest-first, names resolved ---------
  const listSuggestions = async (): Promise<QuestionSuggestion[]> => {
    // Sort a COPY so the stored array's insertion order stays untouched
    // (pure read). resolvePlayerName reuses the shared id→name resolution
    // (falling back to the raw id) rather than duplicating it here.
    const stored = data.suggestions ?? [];
    return [...stored]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((suggestion) => ({
        id: suggestion.id,
        text: suggestion.text,
        suggestedByName: resolvePlayerName(suggestion.suggestedById),
        createdAt: suggestion.createdAt,
      }));
  };

  // --- History: the player's seeded past recaps --------------------------
  const getMyHistory = async (playerId: string): Promise<HistoryEntry[]> =>
    data.history?.[playerId] ?? [];

  return {
    getMyWeek,
    submitAnswers,
    ensureAnswerOptions,
    getGuessSheet,
    submitGuess,
    getLeaderboard,
    closeWeek,
    openWeek,
    getMyHistory,
    getDraftQuestions,
    updateDraftQuestion,
    regenerateQuestion,
    approveWeek,
    restartWeek,
    getAdminMatchups,
    getDraftWeekInfo,
    listRoster,
    upsertPlayer,
    deactivatePlayer,
    setWeekAbsences,
    getPresentPlayers,
    backfillSlackIds,
    suggestQuestion,
    listSuggestions,
    useSuggestion,
    removeSuggestion,
  };
};

// ---------------------------------------------------------------------------
// Default instance
// ---------------------------------------------------------------------------

export const mockGameService: GameService = createMockGameService(
  getMockStore(),
);
