/**
 * dbGameService — Postgres-backed implementation of the GameService interface.
 *
 * Implements every method of GameService using Prisma queries against the
 * production schema. Observable behaviour must match the mock exactly so that
 * swapping `mockGameService` for `dbGameService` produces the same results for
 * any caller.
 *
 * Key design decisions are documented inline.
 */

import { getPrisma } from "@/lib/db/client";
import { computePairing } from "@/lib/pairing";
import { makePairKey } from "@/lib/pairKey";
import { rankPlayers, scoreWeekForPlayer } from "@/lib/scoring";
import { validatePlayerInput } from "@/lib/services/playerValidation";
import {
  DISTRACTOR_COUNT,
  defaultDistractorGenerator,
  defaultQuestionGenerator,
} from "@/lib/ai";
import { WEEKLY_QUESTION_COUNT } from "@/lib/types";
import { resolveSlackIdByEmail } from "@/lib/slack";
import {
  notifyWeekOpened,
  notifyOpponentFinished,
  notifyGuessingUnlockedAll,
  notifyGuessingComplete,
} from "@/lib/notifications";
import type { GameService } from "@/lib/services/gameService";
import { EMPTY_SUGGESTION_MESSAGE } from "@/lib/services/gameService";
import type {
  AdminMatchupStatus,
  AdminWeekOverview,
  AnswerSubmission,
  GuessResult,
  GuessSheet,
  HistoryEntry,
  LeaderboardScope,
  MyWeekView,
  Player,
  Question,
  QuestionSuggestion,
  Recap,
  WeekStatus,
} from "@/lib/types";
import type { RankedRow, ScoreRow } from "@/lib/scoring";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Status values used across multiple methods — avoids literal repetition. */
const STATUS_OPEN = "open" as const;
const STATUS_CLOSED = "closed" as const;
const STATUS_AWAITING_APPROVAL = "awaiting_approval" as const;
const STATUS_DRAFT_QUESTIONS = "draft_questions" as const;

/** Error message when no current season row exists. */
const NO_CURRENT_SEASON_MSG =
  "No current season; run db:seed.";

/** Path (relative to NEXTAUTH_URL) linking to the home / this-week page. */
const THIS_WEEK_PATH = "/";

/**
 * Sentinel weekId returned in the pre-season / cold-start MyWeekView when no
 * week exists in the current season yet. Empty string mirrors the shape used
 * by getAdminMatchups in the same no-week scenario.
 */
const NO_WEEK_ID = "" as const;

/** Number of matchup participants whose answers must land to unlock guessing. */
const PARTICIPANTS_REQUIRED_TO_UNLOCK = 2;

/**
 * When regenerating one draft question slot, request this many candidates from
 * the generator so the full canned pool is available for distinctness checking.
 */
const REGENERATE_CANDIDATE_COUNT = WEEKLY_QUESTION_COUNT * 3;

/**
 * Duration of one week in milliseconds (used for draft week date computation).
 * Named rather than a bare literal per the magic-numbers rule.
 */
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Interactive-transaction timeout in milliseconds.
 *
 * Prisma's default is 5 000 ms, which is too short for Neon's network latency
 * when ~39 sequential writes are performed (the pre-batching behaviour). After
 * batching the write count drops to ~2-3 queries, but we keep this safety
 * margin as belt-and-suspenders for any remaining round-trips.
 */
const TX_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// WeeklyScoreRow — shared row type used by closeWeek and approveWeek
// ---------------------------------------------------------------------------

/**
 * Shape of a weekly_score row to persist.
 * Defined at module scope so both closeWeek and approveWeek reference the
 * same type via collectWeeklyScoreRows.
 */
type WeeklyScoreRow = {
  weekId: string;
  playerId: string;
  seasonId: string;
  participationPoints: number;
  correctGuesses: number;
  totalPoints: number;
};

// ---------------------------------------------------------------------------
// Fisher–Yates shuffle (mirrors the mock's defaultShuffle)
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
// Admin-matchup status derivation (mirrors the mock)
// ---------------------------------------------------------------------------

const deriveMatchupStatus = (answeredCount: number): AdminMatchupStatus => {
  if (answeredCount >= PARTICIPANTS_REQUIRED_TO_UNLOCK) return "guessing_unlocked";
  if (answeredCount === 1) return "awaiting_one";
  return "awaiting_both";
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a Postgres-backed GameService.
 *
 * The factory itself must NOT call getPrisma() — that would trigger the
 * DATABASE_URL check at import time and break mock-mode startup. All Prisma
 * usage is deferred to inside method bodies.
 */
export function createDbGameService(): GameService {
  // -------------------------------------------------------------------------
  // Season / week resolution helpers
  //
  // These are defined as closures inside the factory so they share the same
  // lexical scope and are only callable after a method is invoked (lazy).
  // -------------------------------------------------------------------------

  /**
   * Returns the current season row.
   * Throws a clear error when no season is flagged isCurrent = true.
   */
  const requireCurrentSeason = async () => {
    const prisma = getPrisma();
    const season = await prisma.season.findFirst({
      where: { isCurrent: true },
    });
    if (!season) throw new Error(NO_CURRENT_SEASON_MSG);
    return season;
  };

  /**
   * Returns the current week within the given season using this precedence:
   *   1. The week with status "open" (live week).
   *   2. The most-recent closed week (by startsAt desc) — post-week recap state.
   *   3. A draft week (awaiting_approval preferred, then draft_questions) —
   *      pre-open / cold-start state so callers never throw before a week opens.
   *   4. null — no week at all in this season.
   *
   * Mirrors the mock's single `currentWeek` reference extended for the cases
   * where no open or closed week exists yet (e.g. freshly seeded DB).
   */
  const getCurrentWeek = async (seasonId: string) => {
    const prisma = getPrisma();

    // 1. Prefer the open week — order by startsAt desc so the MOST RECENT open
    //    week wins (defensive against the multi-open-week bug, and invariant
    //    post-fix: only one open week should ever exist).
    const openWeek = await prisma.week.findFirst({
      where: { seasonId, status: STATUS_OPEN },
      orderBy: { startsAt: "desc" },
    });
    if (openWeek) return openWeek;

    // 2. Fall back to the most-recent closed week.
    const recentClosedWeek = await prisma.week.findFirst({
      where: { seasonId, status: STATUS_CLOSED },
      orderBy: { startsAt: "desc" },
    });
    if (recentClosedWeek) return recentClosedWeek;

    // 3. Fall back to the draft week (awaiting_approval first, then draft_questions).
    const draftWeek = await getDraftWeek(seasonId);
    return draftWeek ?? null;
  };

  /**
   * Returns the draft week within the current season.
   * Priority: awaiting_approval > draft_questions.
   *
   * NOTE: Admin routes pass the literal UPCOMING_WEEK_ID constant ("week-2026-26")
   * as the weekId argument. The DB does NOT have that id. For all draft-week
   * operations (getDraftQuestions, updateDraftQuestion, regenerateQuestion,
   * approveWeek) we IGNORE the literal weekId and instead resolve "the current
   * season's draft week" by status. This is documented on each method.
   */
  const getDraftWeek = async (seasonId: string) => {
    const prisma = getPrisma();
    const awaitingWeek = await prisma.week.findFirst({
      where: { seasonId, status: STATUS_AWAITING_APPROVAL },
    });
    if (awaitingWeek) return awaitingWeek;

    const draftWeek = await prisma.week.findFirst({
      where: { seasonId, status: STATUS_DRAFT_QUESTIONS },
    });
    return draftWeek;
  };

  /**
   * Builds a map of weekId → 0-based weekIndex within the season,
   * ordered by startsAt ascending. The weekIndex is used by computePairing
   * to compare historical pairing recency.
   */
  const buildWeekIndexMap = async (
    seasonId: string,
  ): Promise<Map<string, number>> => {
    const prisma = getPrisma();
    const weeks = await prisma.week.findMany({
      where: { seasonId },
      orderBy: { startsAt: "asc" },
      select: { id: true },
    });
    const map = new Map<string, number>();
    weeks.forEach((w, i) => map.set(w.id, i));
    return map;
  };

  // -------------------------------------------------------------------------
  // Pairing helpers
  // -------------------------------------------------------------------------

  /**
   * Resolves present player ids for a given week:
   *   active players MINUS those with a WeekParticipant{ absent: true }
   *   for that week.
   * Mirrors the mock's resolvePresentPlayerIds.
   */
  const resolvePresentPlayerIds = async (
    weekId: string,
  ): Promise<string[]> => {
    const prisma = getPrisma();
    const [activePlayers, absentParticipants] = await Promise.all([
      prisma.player.findMany({
        where: { active: true },
        select: { id: true },
      }),
      prisma.weekParticipant.findMany({
        where: { weekId, absent: true },
        select: { playerId: true },
      }),
    ]);

    const absentIds = new Set(absentParticipants.map((p) => p.playerId));
    return activePlayers
      .filter((p) => !absentIds.has(p.id))
      .map((p) => p.id);
  };

  /**
   * Gathers pairing history for the current season and runs computePairing.
   * Creates Matchup + WeekParticipant rows inside a provided transaction.
   *
   * The @@unique([seasonId, pairKey]) guard at the DB level backs the no-repeat
   * rule. The pairing engine already avoids repeats; a P2002 here is unexpected
   * and is caught and rethrown with a clear message.
   */
  const runPairingForWeek = async (
    tx: Parameters<Parameters<ReturnType<typeof getPrisma>["$transaction"]>[0]>[0],
    weekId: string,
    seasonId: string,
    weekIndexMap: Map<string, number>,
  ): Promise<void> => {
    // --- Resolve present player ids ---
    const presentPlayerIds = await resolvePresentPlayerIds(weekId);

    // --- Gather prior season history ---
    // The season-wide no-repeat invariant is enforced against PRIOR weeks only.
    // The week being paired is EXCLUDED from its own history (weekId: { not })
    // so a re-pair of the same week never treats its own current pairs/byes as
    // "history to avoid" — that was the source of the doubled, disjoint matching.
    const [allMatchups, allByeParticipants] = await Promise.all([
      tx.matchup.findMany({
        where: { seasonId, weekId: { not: weekId } },
        select: { playerAId: true, playerBId: true, weekId: true },
      }),
      tx.weekParticipant.findMany({
        where: {
          week: { seasonId },
          weekId: { not: weekId },
          isBye: true,
        },
        select: { playerId: true, weekId: true },
      }),
    ]);

    const priorPairs = allMatchups
      .map((m) => ({
        a: m.playerAId,
        b: m.playerBId,
        weekIndex: weekIndexMap.get(m.weekId) ?? 0,
      }));

    const priorByes = allByeParticipants
      .map((p) => ({
        playerId: p.playerId,
        weekIndex: weekIndexMap.get(p.weekId) ?? 0,
      }));

    // --- Compute pairing ---
    const result = computePairing({ presentPlayerIds, priorPairs, priorByes });

    // --- Persist matchups (batched, idempotent) ---
    // Build the full row array first so we can issue a single createMany,
    // reducing ~13 sequential awaited writes to one round-trip.
    //
    // Clear the week's existing matchups first (mirroring the WeekParticipant
    // deleteMany-then-createMany pattern below). Re-pairing a week therefore
    // REPLACES rather than appends, so the week always ends with exactly one
    // matching — floor(activePlayers / 2) matchups, each player at most once.
    const matchupRows = result.pairs.map(([playerAId, playerBId]) => ({
      weekId,
      playerAId,
      playerBId,
      seasonId,
      pairKey: makePairKey(playerAId, playerBId),
      guessingUnlockedAt: null as Date | null,
    }));

    try {
      await tx.matchup.deleteMany({ where: { weekId } });
      await tx.matchup.createMany({ data: matchupRows });
    } catch (err: unknown) {
      // P2002 = unique constraint violation on @@unique([seasonId, pairKey]).
      // createMany throws P2002 on a duplicate just like create does.
      // This should never fire since computePairing avoids repeats — flag it.
      const code =
        typeof err === "object" &&
        err !== null &&
        "code" in err
          ? (err as { code: string }).code
          : undefined;
      if (code === "P2002") {
        throw new Error(
          `Unexpected duplicate pair in season "${seasonId}". ` +
            `The pairing engine produced a repeat — ` +
            `this violates the @@unique([seasonId, pairKey]) guard.`,
        );
      }
      throw err;
    }

    // --- Persist WeekParticipant rows (batched, idempotent) ---
    // Delete any pre-existing rows for this week (e.g. absence rows created
    // earlier by setWeekAbsences) then insert the full present-player set in
    // one createMany. This replaces ~26 sequential upserts with 2 queries.
    const participantRows = presentPlayerIds.map((playerId) => ({
      weekId,
      playerId,
      absent: false,
      isBye: result.byePlayerId === playerId,
    }));

    await tx.weekParticipant.deleteMany({ where: { weekId } });
    await tx.weekParticipant.createMany({ data: participantRows });
  };

  // -------------------------------------------------------------------------
  // Player shape mapper
  //
  // The Prisma Player row has `slackUserId` which is nullable; the domain type
  // uses an optional field. Map carefully to match Player exactly.
  // -------------------------------------------------------------------------

  const mapPlayer = (row: {
    id: string;
    name: string;
    email: string;
    slackUserId: string | null;
    isAdmin: boolean;
    active: boolean;
  }): Player => ({
    id: row.id,
    name: row.name,
    email: row.email,
    ...(row.slackUserId !== null ? { slackUserId: row.slackUserId } : {}),
    isAdmin: row.isAdmin,
    active: row.active,
  });

  // -------------------------------------------------------------------------
  // Method: getMyWeek
  // -------------------------------------------------------------------------

  const getMyWeek = async (playerId: string): Promise<MyWeekView> => {
    const prisma = getPrisma();
    const season = await requireCurrentSeason();
    const week = await getCurrentWeek(season.id);

    // --- Cold-start: no week exists in this season yet --------------------
    // Return a benign pre-season view rather than throwing — mirrors the mock,
    // which always returns a coherent MyWeekView and never throws here.
    if (!week) {
      return {
        weekId: NO_WEEK_ID,
        startsAt: "",
        status: STATUS_DRAFT_QUESTIONS,
        opponent: null,
        isBye: false,
        questions: [],
        myAnswersSubmitted: false,
        opponentAnswered: false,
        guessingUnlocked: false,
        guessingComplete: false,
        myCorrectGuesses: 0,
      };
    }

    const questions = await prisma.question.findMany({
      where: { weekId: week.id },
      orderBy: { orderIndex: "asc" },
    });

    const domainQuestions: Question[] = questions.map((q) => ({
      id: q.id,
      orderIndex: q.orderIndex,
      text: q.text,
    }));

    // --- Check for bye ---
    const byeParticipant = await prisma.weekParticipant.findFirst({
      where: { weekId: week.id, playerId, isBye: true },
    });

    if (byeParticipant) {
      return {
        weekId: week.id,
        startsAt: week.startsAt.toISOString(),
        status: week.status as WeekStatus,
        opponent: null,
        isBye: true,
        questions: domainQuestions,
        myAnswersSubmitted: false,
        opponentAnswered: false,
        guessingUnlocked: false,
        guessingComplete: false,
        myCorrectGuesses: 0,
      };
    }

    // --- Find matchup ---
    const matchup = await prisma.matchup.findFirst({
      where: {
        weekId: week.id,
        OR: [{ playerAId: playerId }, { playerBId: playerId }],
      },
    });

    if (!matchup) {
      // Week is not open and this player has no matchup/bye — graceful view.
      // (Real data-integrity errors only apply when the week IS open.)
      if (week.status !== STATUS_OPEN) {
        return {
          weekId: week.id,
          startsAt: week.startsAt.toISOString(),
          status: week.status as WeekStatus,
          opponent: null,
          isBye: false,
          questions: domainQuestions,
          myAnswersSubmitted: false,
          opponentAnswered: false,
          guessingUnlocked: false,
          guessingComplete: false,
          myCorrectGuesses: 0,
        };
      }
      // Week IS open but no matchup/bye found — this is a real data-integrity error.
      throw new Error(
        `No matchup or bye found for player "${playerId}" this week.`,
      );
    }

    const opponentId =
      matchup.playerAId === playerId ? matchup.playerBId : matchup.playerAId;

    const opponentRow = await prisma.player.findUnique({
      where: { id: opponentId },
    });
    const opponent = opponentRow ? mapPlayer(opponentRow) : null;

    const [
      myAnswerCount,
      opponentAnswerCount,
      playerGuessCount,
      myCorrectGuesses,
    ] = await Promise.all([
      prisma.answer.count({ where: { matchupId: matchup.id, playerId } }),
      prisma.answer.count({
        where: { matchupId: matchup.id, playerId: opponentId },
      }),
      prisma.guess.count({
        where: { matchupId: matchup.id, guesserId: playerId },
      }),
      prisma.guess.count({
        where: { matchupId: matchup.id, guesserId: playerId, isCorrect: true },
      }),
    ]);

    const myAnswersSubmitted = myAnswerCount > 0;
    const opponentAnswered = opponentAnswerCount > 0;
    const guessingUnlocked = matchup.guessingUnlockedAt !== null;

    // Guessing is complete once the player has a guess for every question.
    const guessingComplete =
      guessingUnlocked && playerGuessCount >= domainQuestions.length;

    const isClosed = week.status === STATUS_CLOSED;

    const view: MyWeekView = {
      weekId: week.id,
      startsAt: week.startsAt.toISOString(),
      status: week.status as WeekStatus,
      opponent,
      isBye: false,
      questions: domainQuestions,
      myAnswersSubmitted,
      opponentAnswered,
      guessingUnlocked,
      guessingComplete,
      myCorrectGuesses,
    };

    if (isClosed) {
      // Build recap from stored guesses / scores.
      const myCorrect = await prisma.guess.count({
        where: { matchupId: matchup.id, guesserId: playerId, isCorrect: true },
      });
      const opponentCorrect = await prisma.guess.count({
        where: { matchupId: matchup.id, guesserId: opponentId, isCorrect: true },
      });
      const recap: Recap = {
        meCorrect: myCorrect,
        opponentCorrect,
        questionCount: domainQuestions.length,
      };
      view.recap = recap;
    }

    return view;
  };

  // -------------------------------------------------------------------------
  // Method: submitAnswers
  // -------------------------------------------------------------------------

  const submitAnswers = async (
    playerId: string,
    weekId: string,
    answers: AnswerSubmission[],
  ): Promise<void> => {
    const prisma = getPrisma();
    const season = await requireCurrentSeason();
    const week = await getCurrentWeek(season.id);

    // --- Week guards ---
    if (!week || week.id !== weekId) {
      throw new Error(`Week "${weekId}" is not the current week.`);
    }
    if (week.status !== STATUS_OPEN) {
      throw new Error("The current week is not open for answers.");
    }

    // --- Eligibility guards ---
    const byeParticipant = await prisma.weekParticipant.findFirst({
      where: { weekId, playerId, isBye: true },
    });
    if (byeParticipant) {
      throw new Error(`Player "${playerId}" is on a bye this week.`);
    }

    const matchup = await prisma.matchup.findFirst({
      where: {
        weekId,
        OR: [{ playerAId: playerId }, { playerBId: playerId }],
      },
    });
    if (!matchup) {
      throw new Error(`No matchup found for player "${playerId}" this week.`);
    }

    // --- Double-submission guard ---
    const existingAnswer = await prisma.answer.findFirst({
      where: { matchupId: matchup.id, playerId },
    });
    if (existingAnswer) {
      throw new Error(`Player "${playerId}" has already submitted.`);
    }

    // --- Answer-set validation (mirrors assertValidAnswerSet) ---
    const questions = await prisma.question.findMany({
      where: { weekId },
    });
    const domainQuestions: Question[] = questions.map((q) => ({
      id: q.id,
      orderIndex: q.orderIndex,
      text: q.text,
    }));

    if (answers.length !== domainQuestions.length) {
      throw new Error(
        `Expected ${domainQuestions.length} answers, received ${answers.length}.`,
      );
    }
    const questionIds = new Set(domainQuestions.map((q) => q.id));
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

    // --- Build answer data before the transaction ---
    // Option generation is now OFF the submit path: it runs in the background
    // via ensureAnswerOptions (and lazily on guess-sheet read) so submitting
    // stays instant. The transaction inserts only the answer text.
    type AnswerData = {
      matchupId: string;
      questionId: string;
      playerId: string;
      text: string;
    };

    const answerDataList: AnswerData[] = answers.map((answer) => ({
      matchupId: matchup.id,
      questionId: answer.questionId,
      playerId,
      text: answer.text,
    }));

    // --- Transactionally insert answers; unlock if both answered ---
    // A P2002 on @@unique([matchupId, questionId, playerId]) means a racing
    // duplicate submission slipped past the pre-transaction guard; surface the
    // same message the mock uses rather than leaking a raw Prisma error.
    // `justUnlocked` captures the open→unlocked transition so we can DM the
    // opponent AFTER the transaction commits (never inside it).
    const opponentId =
      matchup.playerAId === playerId ? matchup.playerBId : matchup.playerAId;
    let justUnlocked = false;
    try {
      await prisma.$transaction(async (tx) => {
        for (const data of answerDataList) {
          await tx.answer.create({
            data: {
              matchupId: data.matchupId,
              questionId: data.questionId,
              playerId: data.playerId,
              text: data.text,
            },
          });
        }

        // Check if both players in the matchup have now submitted.
        const opponentAnswerCount = await tx.answer.count({
          where: { matchupId: matchup.id, playerId: opponentId },
        });

        if (opponentAnswerCount > 0) {
          // Both players have answered — unlock guessing transactionally.
          await tx.matchup.update({
            where: { id: matchup.id },
            data: { guessingUnlockedAt: new Date() },
          });
          justUnlocked = true;
        }
      });
    } catch (err: unknown) {
      // Mirror the pattern in runPairingForWeek: inspect the error code via
      // duck-typing to avoid importing the full Prisma namespace.
      const code =
        typeof err === "object" &&
        err !== null &&
        "code" in err
          ? (err as { code: string }).code
          : undefined;
      if (code === "P2002") {
        // Unique constraint on answers — duplicate submission race condition.
        throw new Error(`Player "${playerId}" has already submitted.`);
      }
      throw err;
    }

    // --- Post-commit side effects: DM the two matchup milestones.
    // These run ONLY after the transaction commits (never inside it); notify*
    // swallows errors and no-ops without a Slack token, so they can never fail
    // or roll back the committed answers.
    //
    // Milestone 1 — FIRST answerer (matchup NOT yet complete, `!justUnlocked`):
    //   the opponent still owes answers, so DM the opponent that the current
    //   player has finished and it's their turn to unlock guessing.
    // Milestone 2 — SECOND answerer (both done, `justUnlocked`): guessing is now
    //   unlocked, so DM BOTH players the guessing-unlocked message.
    const [currentRow, opponentRow] = await Promise.all([
      prisma.player.findUnique({ where: { id: playerId } }),
      prisma.player.findUnique({ where: { id: opponentId } }),
    ]);
    if (currentRow && opponentRow) {
      if (justUnlocked) {
        await notifyGuessingUnlockedAll([
          mapPlayer(currentRow),
          mapPlayer(opponentRow),
        ]);
      } else {
        await notifyOpponentFinished(mapPlayer(opponentRow), currentRow.name);
      }
    }
  };

  // -------------------------------------------------------------------------
  // Method: ensureAnswerOptions — idempotent, race-safe option generation
  //
  // Split out of submitAnswers so submitting is instant; run in the background
  // after submit and lazily on guess-sheet read. Concurrency safety comes from
  // DETERMINISTIC option ids (`${answerId}-opt-N`): overlapping workers collide
  // on the primary key, so exactly one set survives (the P2002 loser no-ops).
  // -------------------------------------------------------------------------

  /** Duck-typed Prisma unique-constraint (P2002) detection, no namespace import. */
  const isP2002 = (err: unknown): boolean =>
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002";

  const ensureAnswerOptions = async (
    playerId: string,
    weekId: string,
  ): Promise<void> => {
    const prisma = getPrisma();

    // Resolve the player's matchup (submitter's matchup need not be unlocked).
    const matchup = await prisma.matchup.findFirst({
      where: {
        weekId,
        OR: [{ playerAId: playerId }, { playerBId: playerId }],
      },
    });
    if (!matchup) {
      return;
    }

    // Load the player's answers with their options + question text.
    const answers = await prisma.answer.findMany({
      where: { matchupId: matchup.id, playerId },
      include: { options: true, question: true },
    });

    // Generate options for each answer that has none yet, CONCURRENTLY: the AI
    // round-trips dominate latency, so Promise.all collapses N sequential awaits.
    await Promise.all(
      answers
        .filter((answer) => answer.options.length === 0)
        .map(async (answer) => {
          const distractors =
            await defaultDistractorGenerator.generateDistractors(
              answer.question.text,
              answer.text,
            );
          const limited = distractors.slice(0, DISTRACTOR_COUNT);

          // DETERMINISTIC ids make concurrent inserts collide → one set survives.
          const data = [
            {
              id: `${answer.id}-opt-0`,
              answerId: answer.id,
              text: answer.text,
              isCorrect: true,
            },
            ...limited.map((text, index) => ({
              id: `${answer.id}-opt-${index + 1}`,
              answerId: answer.id,
              text,
              isCorrect: false,
            })),
          ];

          try {
            await prisma.answerOption.createMany({ data });
          } catch (err: unknown) {
            // Another worker generated concurrently — the deterministic ids
            // collided and that worker won; nothing to do.
            if (!isP2002(err)) {
              throw err;
            }
          }
        }),
    );
  };

  // -------------------------------------------------------------------------
  // Shared guard: resolve a paired, unlocked player or throw
  // Mirrors requireUnlockedMatchup from the mock.
  // -------------------------------------------------------------------------

  const requireUnlockedMatchup = async (
    playerId: string,
    weekId: string,
  ) => {
    const prisma = getPrisma();
    const season = await requireCurrentSeason();
    const week = await getCurrentWeek(season.id);

    if (!week || week.id !== weekId) {
      throw new Error(`Week "${weekId}" is not the current week.`);
    }

    const byeParticipant = await prisma.weekParticipant.findFirst({
      where: { weekId, playerId, isBye: true },
    });
    if (byeParticipant) {
      throw new Error(`Player "${playerId}" is on a bye this week.`);
    }

    const matchup = await prisma.matchup.findFirst({
      where: {
        weekId,
        OR: [{ playerAId: playerId }, { playerBId: playerId }],
      },
    });
    if (!matchup) {
      throw new Error(`No matchup found for player "${playerId}" this week.`);
    }
    if (matchup.guessingUnlockedAt === null) {
      throw new Error(`Guessing is not unlocked for player "${playerId}".`);
    }

    const opponentId =
      matchup.playerAId === playerId ? matchup.playerBId : matchup.playerAId;

    return { matchup, opponentId };
  };

  // -------------------------------------------------------------------------
  // Method: getGuessSheet
  // -------------------------------------------------------------------------

  const getGuessSheet = async (
    playerId: string,
    weekId: string,
  ): Promise<GuessSheet> => {
    const prisma = getPrisma();
    const { matchup, opponentId } = await requireUnlockedMatchup(
      playerId,
      weekId,
    );

    // Lazy backstop: ensure the opponent's options exist before reading.
    await ensureAnswerOptions(opponentId, weekId);

    const questions = await prisma.question.findMany({
      where: { weekId },
      orderBy: { orderIndex: "asc" },
    });

    // Load the player's prior guesses once, keyed by question for O(1) lookup.
    const priorGuesses = await prisma.guess.findMany({
      where: { matchupId: matchup.id, guesserId: playerId },
    });
    const guessByQuestionId = new Map(
      priorGuesses.map((guess) => [guess.questionId, guess]),
    );

    const sheet: GuessSheet = [];
    for (const question of questions) {
      const answer = await prisma.answer.findFirst({
        where: {
          questionId: question.id,
          playerId: opponentId,
        },
        include: { options: true },
      });

      const rawOptions = answer?.options ?? [];
      const shuffled = defaultShuffle(rawOptions);
      const options = shuffled.map((opt) => ({ id: opt.id, text: opt.text }));

      // The opponent's stored answer text IS the real answer for this question.
      const priorGuess = guessByQuestionId.get(question.id);
      const result: GuessResult | null =
        priorGuess && answer
          ? {
              questionId: question.id,
              correct: priorGuess.isCorrect,
              realAnswerText: answer.text,
            }
          : null;

      sheet.push({
        questionId: question.id,
        questionText: question.text,
        options,
        result,
      });
    }

    return sheet;
  };

  // -------------------------------------------------------------------------
  // Method: submitGuess
  // -------------------------------------------------------------------------

  const submitGuess = async (
    playerId: string,
    weekId: string,
    questionId: string,
    chosenOptionId: string,
  ): Promise<GuessResult> => {
    const prisma = getPrisma();
    const { matchup, opponentId } = await requireUnlockedMatchup(playerId, weekId);

    // Lazy backstop: ensure the opponent's options exist before validating.
    await ensureAnswerOptions(opponentId, weekId);

    const question = await prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!question) {
      throw new Error(`Unknown question id "${questionId}".`);
    }

    // Find the opponent's answer for this question and check the chosen option.
    const answer = await prisma.answer.findFirst({
      where: { questionId, playerId: opponentId, matchupId: matchup.id },
      include: { options: true },
    });

    const chosenOption = answer?.options.find((o) => o.id === chosenOptionId);
    if (!chosenOption || !answer) {
      throw new Error(
        `Invalid option "${chosenOptionId}" for question "${questionId}".`,
      );
    }

    // --- Double-guess guard ---
    const existingGuess = await prisma.guess.findFirst({
      where: {
        matchupId: matchup.id,
        questionId,
        guesserId: playerId,
      },
    });
    if (existingGuess) {
      throw new Error(`Question "${questionId}" has already been guessed.`);
    }

    const correct = chosenOption.isCorrect;

    await prisma.guess.create({
      data: {
        matchupId: matchup.id,
        questionId,
        guesserId: playerId,
        chosenOptionId,
        isCorrect: correct,
      },
    });

    // --- Post-commit side effect: DM the guessing-complete milestone.
    // Runs ONLY after the guess is persisted (never before); notifyGuessingComplete
    // swallows errors and no-ops without a Slack token, so it can never fail or
    // undo the committed guess.
    //
    // Milestone — LAST guess: once this player has a guess for every question
    // (same `guessCount >= questionCount` definition as getMyWeek's
    // `guessingComplete`), DM the OPPONENT — whose answers were guessed — the
    // final score. We fire only on the guess that COMPLETES the set, so it
    // never fires early or a second time. The correct-count and player rows are
    // read only inside the branch, so a non-completing guess pays no extra reads.
    const questionCount = await prisma.question.count({
      where: { weekId },
    });
    const guessCount = await prisma.guess.count({
      where: { matchupId: matchup.id, guesserId: playerId },
    });
    if (guessCount >= questionCount) {
      const [correctCount, opponentRow, guesserRow] = await Promise.all([
        prisma.guess.count({
          where: {
            matchupId: matchup.id,
            guesserId: playerId,
            isCorrect: true,
          },
        }),
        prisma.player.findUnique({ where: { id: opponentId } }),
        prisma.player.findUnique({ where: { id: playerId } }),
      ]);
      if (opponentRow && guesserRow) {
        await notifyGuessingComplete(
          mapPlayer(opponentRow),
          guesserRow.name,
          correctCount,
          questionCount,
        );
      }
    }

    return { questionId, correct, realAnswerText: answer.text };
  };

  // -------------------------------------------------------------------------
  // Method: getLeaderboard
  //
  // Decision: rank ALL active players, scoring 0 for those absent from
  // WeeklyScore. This is the "sensible" DB behaviour — the mock seeded an
  // explicit list, but for a real DB it makes sense to include every active
  // player so the leaderboard is always complete.
  // -------------------------------------------------------------------------

  const getLeaderboard = async (scope: LeaderboardScope): Promise<RankedRow[]> => {
    const prisma = getPrisma();
    const season = await requireCurrentSeason();

    const activePlayers = await prisma.player.findMany({
      where: { active: true },
    });

    let scores: { playerId: string; total: number; correctGuesses: number }[];

    if (scope === "season") {
      // Aggregate for the current season only.
      const rows = await prisma.weeklyScore.groupBy({
        by: ["playerId"],
        where: { seasonId: season.id },
        _sum: { totalPoints: true, correctGuesses: true },
      });
      scores = rows.map((r) => ({
        playerId: r.playerId,
        total: r._sum.totalPoints ?? 0,
        correctGuesses: r._sum.correctGuesses ?? 0,
      }));
    } else {
      // all_time: aggregate across all seasons.
      const rows = await prisma.weeklyScore.groupBy({
        by: ["playerId"],
        _sum: { totalPoints: true, correctGuesses: true },
      });
      scores = rows.map((r) => ({
        playerId: r.playerId,
        total: r._sum.totalPoints ?? 0,
        correctGuesses: r._sum.correctGuesses ?? 0,
      }));
    }

    const scoreMap = new Map(scores.map((s) => [s.playerId, s]));

    const rows: ScoreRow[] = activePlayers.map((p) => {
      const s = scoreMap.get(p.id);
      return {
        playerId: p.id,
        name: p.name,
        total: s?.total ?? 0,
        correctGuesses: s?.correctGuesses ?? 0,
      };
    });

    return rankPlayers(rows);
  };

  // -------------------------------------------------------------------------
  // collectWeeklyScoreRows — shared read+compute helper (DRY)
  //
  // Reads matchup answer/guess counts and bye participants for the given week,
  // then computes per-player WeeklyScoreRow values via the pure
  // scoreWeekForPlayer function. Returns the full array ready for persistence.
  //
  // All DB reads happen outside any transaction; callers write the rows inside
  // their own transaction window to keep tx durations short.
  // -------------------------------------------------------------------------

  const collectWeeklyScoreRows = async (
    weekId: string,
    seasonId: string,
  ): Promise<WeeklyScoreRow[]> => {
    const prisma = getPrisma();
    const matchups = await prisma.matchup.findMany({ where: { weekId } });

    const scoreRows: WeeklyScoreRow[] = [];

    // --- Score matchup participants ---
    for (const matchup of matchups) {
      for (const playerId of [matchup.playerAId, matchup.playerBId]) {
        const [submittedCount, correctCount] = await Promise.all([
          prisma.answer.count({ where: { matchupId: matchup.id, playerId } }),
          prisma.guess.count({
            where: {
              matchupId: matchup.id,
              guesserId: playerId,
              isCorrect: true,
            },
          }),
        ]);

        const scoreResult = scoreWeekForPlayer({
          submittedOwnAnswers: submittedCount > 0,
          correctGuesses: correctCount,
          isBye: false,
        });

        scoreRows.push({
          weekId,
          playerId,
          seasonId,
          participationPoints: scoreResult.participation,
          correctGuesses: scoreResult.correctGuesses,
          totalPoints: scoreResult.total,
        });
      }
    }

    // --- Score bye players (all zeros per scoreWeekForPlayer contract) ---
    const byeParticipants = await prisma.weekParticipant.findMany({
      where: { weekId, isBye: true },
    });

    for (const participant of byeParticipants) {
      const byeScore = scoreWeekForPlayer({
        submittedOwnAnswers: false,
        correctGuesses: 0,
        isBye: true,
      });

      scoreRows.push({
        weekId,
        playerId: participant.playerId,
        seasonId,
        participationPoints: byeScore.participation,
        correctGuesses: byeScore.correctGuesses,
        totalPoints: byeScore.total,
      });
    }

    return scoreRows;
  };

  // -------------------------------------------------------------------------
  // Method: closeWeek
  // -------------------------------------------------------------------------

  const closeWeek = async (weekId: string): Promise<void> => {
    const prisma = getPrisma();
    const season = await requireCurrentSeason();
    const week = await getCurrentWeek(season.id);

    if (!week || week.id !== weekId) {
      throw new Error(`Week "${weekId}" is not the current week.`);
    }

    // --- Compute all weekly-score rows before the transaction ---
    // scoreWeekForPlayer is a pure function; reads happen via the shared helper
    // so the transaction window only contains writes.
    const scoreRows = await collectWeeklyScoreRows(weekId, season.id);

    // --- Transactionally write scores (batched, idempotent) ---
    // deleteMany + createMany replaces ~26 sequential upserts with 2 queries,
    // keeping the method idempotent if re-run.
    await prisma.$transaction(async (tx) => {
      // Mark the week as closed.
      await tx.week.update({
        where: { id: weekId },
        data: { status: STATUS_CLOSED },
      });

      // Replace all weekly scores for this week atomically.
      await tx.weeklyScore.deleteMany({ where: { weekId } });
      await tx.weeklyScore.createMany({ data: scoreRows });
    }, { timeout: TX_TIMEOUT_MS });
  };

  // -------------------------------------------------------------------------
  // Method: openWeek
  //
  // openWeek in the mock sets the currentWeek to open and runs pairing.
  // In the DB the week already exists (created as a draft); we set its
  // status to open and run pairing.
  // -------------------------------------------------------------------------

  const openWeek = async (weekId: string): Promise<void> => {
    const prisma = getPrisma();
    const season = await requireCurrentSeason();
    const week = await getCurrentWeek(season.id);

    if (!week || week.id !== weekId) {
      throw new Error(`Week "${weekId}" is not the current week.`);
    }

    const weekIndexMap = await buildWeekIndexMap(season.id);

    await prisma.$transaction(async (tx) => {
      await tx.week.update({
        where: { id: weekId },
        data: { status: STATUS_OPEN },
      });

      await runPairingForWeek(tx, weekId, season.id, weekIndexMap);
    }, { timeout: TX_TIMEOUT_MS });
  };

  // -------------------------------------------------------------------------
  // Method: getMyHistory
  // -------------------------------------------------------------------------

  const getMyHistory = async (playerId: string): Promise<HistoryEntry[]> => {
    const prisma = getPrisma();
    const season = await requireCurrentSeason();

    // Find all closed weeks in the current season where the player participated
    // in a matchup (not bye).
    const matchups = await prisma.matchup.findMany({
      where: {
        seasonId: season.id,
        week: { status: STATUS_CLOSED },
        OR: [{ playerAId: playerId }, { playerBId: playerId }],
      },
      include: { week: true },
      orderBy: { week: { startsAt: "asc" } },
    });

    const entries: HistoryEntry[] = [];

    for (const matchup of matchups) {
      const opponentId =
        matchup.playerAId === playerId ? matchup.playerBId : matchup.playerAId;

      const opponentRow = await prisma.player.findUnique({
        where: { id: opponentId },
        select: { name: true },
      });
      const opponentName = opponentRow?.name ?? opponentId;

      const questionCount = await prisma.question.count({
        where: { weekId: matchup.weekId },
      });

      const [meCorrect, opponentCorrect] = await Promise.all([
        prisma.guess.count({
          where: {
            matchupId: matchup.id,
            guesserId: playerId,
            isCorrect: true,
          },
        }),
        prisma.guess.count({
          where: {
            matchupId: matchup.id,
            guesserId: opponentId,
            isCorrect: true,
          },
        }),
      ]);

      entries.push({
        weekId: matchup.weekId,
        startsAt: matchup.week.startsAt.toISOString(),
        opponentName,
        recap: { meCorrect, opponentCorrect, questionCount },
      });
    }

    return entries;
  };

  // -------------------------------------------------------------------------
  // Method: getDraftQuestions
  //
  // NOTE: The `weekId` argument is IGNORED for DB resolution. Admin routes pass
  // the literal UPCOMING_WEEK_ID constant; the DB resolves the draft week by
  // status instead (awaiting_approval, then draft_questions). This is
  // intentional and documented on the getDraftWeek helper above.
  //
  // Idempotent: if a draft week already exists, return its questions.
  // If no draft week exists, create one (with WEEKLY_QUESTION_COUNT questions
  // from the default generator (Gemini-backed, stub fallback), status
  // awaiting_approval, startsAt = next Monday after the latest week in the
  // season or now if no weeks exist).
  // -------------------------------------------------------------------------

  const getDraftQuestions = async (_weekId: string): Promise<Question[]> => {
    const prisma = getPrisma();
    const season = await requireCurrentSeason();
    const existingDraft = await getDraftWeek(season.id);

    if (existingDraft) {
      // Idempotent: return existing questions sorted by orderIndex.
      const questions = await prisma.question.findMany({
        where: { weekId: existingDraft.id },
        orderBy: { orderIndex: "asc" },
      });
      return questions.map((q) => ({
        id: q.id,
        orderIndex: q.orderIndex,
        text: q.text,
      }));
    }

    // --- Create a new draft week ---
    // Date computation: use the Monday after the latest week in the season,
    // or 7 days from now if no weeks exist yet. This is a reasonable heuristic
    // for a weekly game; comment here in case a reviewer wants a different policy.
    const latestWeek = await prisma.week.findFirst({
      where: { seasonId: season.id },
      orderBy: { startsAt: "desc" },
    });

    const startsAt = latestWeek
      ? new Date(latestWeek.startsAt.getTime() + ONE_WEEK_MS)
      : new Date(Date.now() + ONE_WEEK_MS);

    const endsAt = new Date(startsAt.getTime() + ONE_WEEK_MS);

    // Generate questions via the default generator (Gemini-backed, stub
    // fallback) — matches the mock service's behaviour.
    const texts = await defaultQuestionGenerator.generateQuestions(
      WEEKLY_QUESTION_COUNT,
    );

    const newDraftWeek = await prisma.week.create({
      data: {
        seasonId: season.id,
        startsAt,
        endsAt,
        status: STATUS_AWAITING_APPROVAL,
        questions: {
          create: texts.map((text, i) => ({
            orderIndex: i,
            text,
            approved: false,
          })),
        },
      },
      include: { questions: { orderBy: { orderIndex: "asc" } } },
    });

    return newDraftWeek.questions.map((q) => ({
      id: q.id,
      orderIndex: q.orderIndex,
      text: q.text,
    }));
  };

  // -------------------------------------------------------------------------
  // Method: updateDraftQuestion
  //
  // weekId arg is irrelevant; operates on the draft week resolved by status.
  // -------------------------------------------------------------------------

  const updateDraftQuestion = async (
    questionId: string,
    text: string,
  ): Promise<Question[]> => {
    const prisma = getPrisma();
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new Error("Question text must not be empty or whitespace-only.");
    }

    const season = await requireCurrentSeason();
    const draft = await getDraftWeek(season.id);
    if (!draft) {
      throw new Error("No draft week exists. Call getDraftQuestions first.");
    }

    // Verify the question belongs to the draft week.
    const question = await prisma.question.findFirst({
      where: { id: questionId, weekId: draft.id },
    });
    if (!question) {
      throw new Error(`Unknown draft question id "${questionId}".`);
    }

    await prisma.question.update({
      where: { id: questionId },
      data: { text: trimmed },
    });

    const updated = await prisma.question.findMany({
      where: { weekId: draft.id },
      orderBy: { orderIndex: "asc" },
    });

    return updated.map((q) => ({
      id: q.id,
      orderIndex: q.orderIndex,
      text: q.text,
    }));
  };

  // -------------------------------------------------------------------------
  // Method: regenerateQuestion
  //
  // Mirrors the mock: request REGENERATE_CANDIDATE_COUNT candidates, prefer
  // a candidate absent from ALL current draft texts, fall back to any that
  // differs from the current slot's own text.
  // -------------------------------------------------------------------------

  const regenerateQuestion = async (questionId: string): Promise<Question[]> => {
    const prisma = getPrisma();
    const season = await requireCurrentSeason();
    const draft = await getDraftWeek(season.id);
    if (!draft) {
      throw new Error("No draft week exists. Call getDraftQuestions first.");
    }

    const question = await prisma.question.findFirst({
      where: { id: questionId, weekId: draft.id },
    });
    if (!question) {
      throw new Error(`Unknown draft question id "${questionId}".`);
    }

    const allDraftQuestions = await prisma.question.findMany({
      where: { weekId: draft.id },
    });

    const currentText = question.text;
    const otherDraftTexts = new Set(
      allDraftQuestions
        .filter((q) => q.id !== questionId)
        .map((q) => q.text),
    );

    const candidates = await defaultQuestionGenerator.generateQuestions(
      REGENERATE_CANDIDATE_COUNT,
    );

    const fresh =
      candidates.find((c) => c !== currentText && !otherDraftTexts.has(c)) ??
      candidates.find((c) => c !== currentText);

    if (fresh !== undefined) {
      await prisma.question.update({
        where: { id: questionId },
        data: { text: fresh },
      });
    }

    const updated = await prisma.question.findMany({
      where: { weekId: draft.id },
      orderBy: { orderIndex: "asc" },
    });

    return updated.map((q) => ({
      id: q.id,
      orderIndex: q.orderIndex,
      text: q.text,
    }));
  };

  // -------------------------------------------------------------------------
  // Method: approveWeek
  //
  // NOTE: The `weekId` argument is IGNORED for DB resolution (same as
  // getDraftQuestions — the literal UPCOMING_WEEK_ID is passed by routes but
  // is not a real DB id). We operate on the draft week resolved by status.
  //
  // Roll-over behaviour (interim stand-in for the slice-13 week-close job):
  //   Before opening the new draft week, this method closes ALL currently-open
  //   weeks in the season and materialises their weekly_score rows. In the
  //   steady state there will be at most one open week; however the live DB
  //   currently has two open weeks due to a prior bug, so we handle a list.
  //   This close-prior-then-open approach is an intentional divergence from the
  //   mock, whose single-slot model cannot represent multiple week rows.
  //
  // Post-condition invariant: exactly ONE open week (the newly approved draft);
  //   all prior open weeks are STATUS_CLOSED with materialized weekly_scores.
  //
  // Idempotent: if there is no draft AND an open week already exists → no-op.
  //   If there is no draft AND no open week → throw (as before).
  // -------------------------------------------------------------------------

  const approveWeek = async (_weekId: string): Promise<void> => {
    const prisma = getPrisma();
    const season = await requireCurrentSeason();
    const draft = await getDraftWeek(season.id);

    // --- Idempotent guard ---
    // No draft: either already open (no-op) or nothing to do at all (error).
    if (!draft) {
      const openWeek = await prisma.week.findFirst({
        where: { seasonId: season.id, status: STATUS_OPEN },
      });
      if (openWeek) {
        // Already open — idempotent no-op.
        return;
      }
      throw new Error(
        "No draft week found. Call getDraftQuestions first.",
      );
    }

    // --- Pre-transaction reads ---
    // Find ALL currently-open weeks so we can close them in the same tx.
    // In steady state this list has ≤1 entry; it may have 2 from the prior bug.
    const priorOpenWeeks = await prisma.week.findMany({
      where: { seasonId: season.id, status: STATUS_OPEN },
    });

    // Compute score rows for each prior open week OUTSIDE the transaction to
    // keep the tx short (mirrors closeWeek's pattern).
    const priorWeekScoreRows: Array<{ weekId: string; rows: WeeklyScoreRow[] }> =
      await Promise.all(
        priorOpenWeeks.map(async (w) => ({
          weekId: w.id,
          rows: await collectWeeklyScoreRows(w.id, season.id),
        })),
      );

    // Build week-index map outside the transaction (read-only).
    const weekIndexMap = await buildWeekIndexMap(season.id);

    // --- Single transaction: close prior weeks, open draft, run pairing ---
    await prisma.$transaction(async (tx) => {
      // Close each prior open week and persist its materialized scores.
      for (const { weekId, rows } of priorWeekScoreRows) {
        await tx.weeklyScore.deleteMany({ where: { weekId } });
        await tx.weeklyScore.createMany({ data: rows });
        await tx.week.update({
          where: { id: weekId },
          data: { status: STATUS_CLOSED },
        });
      }

      // Open the draft week with approval timestamp.
      await tx.week.update({
        where: { id: draft.id },
        data: {
          status: STATUS_OPEN,
          questionsApprovedAt: new Date(),
        },
      });

      // Run pairing — creates Matchup + WeekParticipant rows for the new week.
      // runPairingForWeek's season-wide priorPairs/priorByes derivation still
      // counts the just-closed week's matchups, preserving the season no-repeat
      // invariant correctly.
      await runPairingForWeek(tx, draft.id, season.id, weekIndexMap);
    }, { timeout: TX_TIMEOUT_MS });

    // --- Post-commit side effect: DM present players the new week is open ---
    // Notifications are never run inside the transaction and never affect its
    // result. notifyWeekOpened delegates to the safe notify functions (which
    // catch their own failures), so awaiting it here cannot break approveWeek.
    const presentIds = await resolvePresentPlayerIds(draft.id);
    const presentRows = await prisma.player.findMany({
      where: { id: { in: presentIds } },
    });
    const presentPlayers = presentRows.map(mapPlayer);
    const weekLink = `${process.env.NEXTAUTH_URL ?? ""}${THIS_WEEK_PATH}`;
    await notifyWeekOpened(presentPlayers, weekLink);
  };

  // -------------------------------------------------------------------------
  // Method: restartWeek
  //
  // Reverts the current OPEN week to the questions-review (awaiting_approval)
  // state and wipes all play so the admin can edit/keep questions and
  // re-approve. Re-approval re-pairs over the live active roster (its
  // runPairingForWeek already excludes the week from its own history), so no
  // new pairing code lives here. Questions are PRESERVED (never deleted).
  //
  // Delete ordering respects FK constraints (children before parents):
  //   guess (by matchupId) → answerOption (by answer→matchup) → answer
  //   (by matchupId) → weeklyScore (by weekId) → matchup (by weekId) →
  //   weekParticipant (by weekId). AnswerOption/Guess are scoped by matchupId,
  //   so we first collect this week's matchup ids and delete by those.
  // -------------------------------------------------------------------------

  const restartWeek = async (weekId: string): Promise<void> => {
    const prisma = getPrisma();
    const season = await requireCurrentSeason();

    // --- Resolve and guard the open week ---------------------------------
    const openWeek = await prisma.week.findFirst({
      where: { seasonId: season.id, status: STATUS_OPEN },
    });
    if (!openWeek || openWeek.id !== weekId) {
      throw new Error(
        `Only the current open week can be restarted; week "${weekId}" is not open.`,
      );
    }

    // --- Collect this week's matchup ids (AnswerOption/Guess key off these) -
    const weekMatchups = await prisma.matchup.findMany({
      where: { weekId },
      select: { id: true },
    });
    const matchupIds = weekMatchups.map((m) => m.id);

    // --- Single transaction: delete play + pairing, revert status ---------
    await prisma.$transaction(async (tx) => {
      // Children before parents (FK-safe ordering).
      await tx.guess.deleteMany({ where: { matchupId: { in: matchupIds } } });
      await tx.answerOption.deleteMany({
        where: { answer: { matchupId: { in: matchupIds } } },
      });
      await tx.answer.deleteMany({ where: { matchupId: { in: matchupIds } } });
      await tx.weeklyScore.deleteMany({ where: { weekId } });
      await tx.matchup.deleteMany({ where: { weekId } });
      await tx.weekParticipant.deleteMany({ where: { weekId } });

      // Revert the week to review (questions are preserved, not deleted).
      await tx.week.update({
        where: { id: weekId },
        data: {
          status: STATUS_AWAITING_APPROVAL,
          questionsApprovedAt: null,
        },
      });
    }, { timeout: TX_TIMEOUT_MS });
  };

  // -------------------------------------------------------------------------
  // Method: getAdminMatchups
  // -------------------------------------------------------------------------

  const getAdminMatchups = async (): Promise<AdminWeekOverview> => {
    const prisma = getPrisma();
    const season = await requireCurrentSeason();
    const week = await getCurrentWeek(season.id);

    if (!week) {
      // No current week — return an empty overview with a sensible placeholder.
      return {
        weekId: "",
        startsAt: "",
        weekStatus: "draft_questions",
        matchups: [],
        byePlayers: [],
      };
    }

    const [matchups, byeParticipants] = await Promise.all([
      prisma.matchup.findMany({
        where: { weekId: week.id },
        include: {
          playerA: true,
          playerB: true,
          answers: { select: { playerId: true } },
        },
      }),
      prisma.weekParticipant.findMany({
        where: { weekId: week.id, isBye: true },
        include: { player: true },
      }),
    ]);

    const matchupRows = matchups.map((m) => {
      const answeredPlayerIds = new Set(m.answers.map((a) => a.playerId));
      const answeredCount = new Set([
        ...(answeredPlayerIds.has(m.playerAId) ? [m.playerAId] : []),
        ...(answeredPlayerIds.has(m.playerBId) ? [m.playerBId] : []),
      ]).size;

      return {
        matchupId: m.id,
        playerA: {
          id: m.playerAId,
          name: m.playerA.name,
          answered: answeredPlayerIds.has(m.playerAId),
        },
        playerB: {
          id: m.playerBId,
          name: m.playerB.name,
          answered: answeredPlayerIds.has(m.playerBId),
        },
        status: deriveMatchupStatus(answeredCount),
      };
    });

    const byePlayers = byeParticipants.map((p) => ({
      id: p.playerId,
      name: p.player.name,
    }));

    return {
      weekId: week.id,
      startsAt: week.startsAt.toISOString(),
      weekStatus: week.status as WeekStatus,
      matchups: matchupRows,
      byePlayers,
    };
  };

  // -------------------------------------------------------------------------
  // Method: getDraftWeekInfo
  //
  // Resolves the draft week by status (awaiting_approval > draft_questions) via
  // the shared getDraftWeek helper; returns its id + ISO start date, or null
  // when no draft week exists. Mirrors the mock's getDraftWeekInfo.
  // -------------------------------------------------------------------------

  const getDraftWeekInfo = async (): Promise<
    { weekId: string; startsAt: string } | null
  > => {
    const season = await requireCurrentSeason();
    const draft = await getDraftWeek(season.id);
    return draft
      ? { weekId: draft.id, startsAt: draft.startsAt.toISOString() }
      : null;
  };

  // -------------------------------------------------------------------------
  // Method: listRoster
  // -------------------------------------------------------------------------

  const listRoster = async (): Promise<Player[]> => {
    const prisma = getPrisma();
    const players = await prisma.player.findMany({
      orderBy: { createdAt: "asc" },
    });
    return players.map(mapPlayer);
  };

  // -------------------------------------------------------------------------
  // Method: upsertPlayer
  // -------------------------------------------------------------------------

  const upsertPlayer = async (player: Player): Promise<Player[]> => {
    validatePlayerInput(player);
    const prisma = getPrisma();

    // REPLACE semantics: set every field from the input, clearing slackUserId
    // when absent (store null per the spec instruction).
    await prisma.player.upsert({
      where: { id: player.id },
      create: {
        id: player.id,
        name: player.name,
        email: player.email,
        slackUserId: player.slackUserId ?? null,
        isAdmin: player.isAdmin,
        active: player.active,
      },
      update: {
        name: player.name,
        email: player.email,
        slackUserId: player.slackUserId ?? null,
        isAdmin: player.isAdmin,
        active: player.active,
      },
    });

    return listRoster();
  };

  // -------------------------------------------------------------------------
  // Method: deactivatePlayer
  // -------------------------------------------------------------------------

  const deactivatePlayer = async (playerId: string): Promise<Player[]> => {
    const prisma = getPrisma();
    const existing = await prisma.player.findUnique({ where: { id: playerId } });
    if (!existing) {
      throw new Error(
        `Cannot deactivate: player with id "${playerId}" does not exist.`,
      );
    }
    await prisma.player.update({
      where: { id: playerId },
      data: { active: false },
    });
    return listRoster();
  };

  // -------------------------------------------------------------------------
  // Method: backfillSlackIds
  //
  // Admin action: for every ACTIVE player still missing a slack_user_id,
  // resolve it from their email via the Slack API and persist it. Returns the
  // number updated. Players that can't be resolved (no match / no token) are
  // left untouched. resolveSlackIdByEmail never throws (returns null on error).
  // -------------------------------------------------------------------------

  const backfillSlackIds = async (): Promise<{ updated: number }> => {
    const prisma = getPrisma();
    const unlinked = await prisma.player.findMany({
      where: { active: true, slackUserId: null },
    });

    let updated = 0;
    for (const player of unlinked) {
      const slackUserId = await resolveSlackIdByEmail(player.email);
      if (slackUserId) {
        await prisma.player.update({
          where: { id: player.id },
          data: { slackUserId },
        });
        updated += 1;
      }
    }
    return { updated };
  };

  // -------------------------------------------------------------------------
  // Method: setWeekAbsences
  //
  // Guard: reject if the draft/upcoming week is already open or closed.
  // In the DB, "the week" referred to by the admin route is resolved as the
  // draft week (by status), not by the literal weekId constant. However, the
  // guard compares against ALL weeks to support future flexibility — if the
  // caller passes a real week id that is open/closed, we reject it.
  // -------------------------------------------------------------------------

  const setWeekAbsences = async (
    weekId: string,
    absentPlayerIds: string[],
  ): Promise<void> => {
    const prisma = getPrisma();
    const season = await requireCurrentSeason();

    // Resolve the target week: try by weekId first (for real DB ids), then
    // fall back to the draft week (for the UPCOMING_WEEK_ID constant).
    let targetWeek = await prisma.week.findFirst({
      where: { id: weekId, seasonId: season.id },
    });

    if (!targetWeek) {
      // The caller passed the UPCOMING_WEEK_ID literal — resolve to draft week.
      targetWeek = await getDraftWeek(season.id);
    }

    if (!targetWeek) {
      // No draft week; create one implicitly so absences can be set.
      // In practice the admin flow calls getDraftQuestions first, so this path
      // is a safety net. We cannot set absences without a target week.
      throw new Error(
        `No week found for id "${weekId}". Call getDraftQuestions first.`,
      );
    }

    // Guard: cannot change absences for an open or closed week.
    if (
      targetWeek.status === STATUS_OPEN ||
      targetWeek.status === STATUS_CLOSED
    ) {
      throw new Error(
        `Cannot set absences for week "${weekId}": week is already ${targetWeek.status}.`,
      );
    }

    const resolvedWeekId = targetWeek.id;

    // Replace absent participants for this week:
    // Delete all absent=true rows, then insert the new set.
    await prisma.$transaction(async (tx) => {
      await tx.weekParticipant.deleteMany({
        where: { weekId: resolvedWeekId, absent: true },
      });

      for (const playerId of absentPlayerIds) {
        await tx.weekParticipant.upsert({
          where: {
            weekId_playerId: { weekId: resolvedWeekId, playerId },
          },
          create: { weekId: resolvedWeekId, playerId, absent: true, isBye: false },
          update: { absent: true },
        });
      }
    });
  };

  // -------------------------------------------------------------------------
  // Method: getPresentPlayers
  //
  // Returns active players minus those with absent=true for the given week.
  // When the weekId is the UPCOMING_WEEK_ID literal, resolve to the draft week.
  // -------------------------------------------------------------------------

  const getPresentPlayers = async (weekId: string): Promise<Player[]> => {
    const prisma = getPrisma();
    const season = await requireCurrentSeason();

    // Resolve the actual week id (handles UPCOMING_WEEK_ID literal).
    let resolvedWeekId = weekId;
    const directWeek = await prisma.week.findFirst({
      where: { id: weekId, seasonId: season.id },
    });
    if (!directWeek) {
      const draftWeek = await getDraftWeek(season.id);
      resolvedWeekId = draftWeek?.id ?? weekId;
    }

    const presentIds = await resolvePresentPlayerIds(resolvedWeekId);
    const presentSet = new Set(presentIds);

    const players = await prisma.player.findMany({
      where: { active: true },
    });

    return players.filter((p) => presentSet.has(p.id)).map(mapPlayer);
  };

  // -------------------------------------------------------------------------
  // Method: suggestQuestion
  //
  // Week-agnostic: does NOT resolve a current season/week. Trims the text and
  // throws BEFORE touching Prisma on empty/whitespace-only input, then inserts
  // one row (Prisma owns id/createdAt via schema defaults).
  // -------------------------------------------------------------------------

  const suggestQuestion = async (
    playerId: string,
    text: string,
  ): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new Error(EMPTY_SUGGESTION_MESSAGE);
    }

    const prisma = getPrisma();
    await prisma.questionSuggestion.create({
      data: { text: trimmed, suggestedById: playerId },
    });
  };

  // -------------------------------------------------------------------------
  // Method: listSuggestions
  //
  // Week-agnostic read of the standing pool. Joins the Player relation for the
  // suggester name and lets the DB do the newest-first ordering. Each row's
  // Date createdAt is converted to its ISO string form (mirroring the
  // startsAt.toISOString() Date→ISO conversion used elsewhere in this service).
  // -------------------------------------------------------------------------

  const listSuggestions = async (): Promise<QuestionSuggestion[]> => {
    const prisma = getPrisma();
    const rows = await prisma.questionSuggestion.findMany({
      include: { suggestedBy: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      text: row.text,
      suggestedByName: row.suggestedBy.name,
      createdAt: row.createdAt.toISOString(),
    }));
  };

  // -------------------------------------------------------------------------
  // Method: useSuggestion
  //
  // Mirrors updateDraftQuestion's draft-week-by-status resolution, then copies
  // the suggestion's text into the chosen slot and hard-deletes the suggestion
  // inside one transaction so the two writes commit together. All existence
  // guards run BEFORE the transaction so a rejected call mutates nothing.
  //
  // Guard order (draft week → suggestion → draft question) differs from the
  // mock's (suggestion → draft week → draft question) because the DB must
  // resolve the draft week to scope the slot lookup. Observable behaviour is
  // identical for any single bad input (the case the callers/tests exercise);
  // only the surfaced message differs if two preconditions fail at once.
  // -------------------------------------------------------------------------

  const useSuggestion = async (
    suggestionId: string,
    draftQuestionId: string,
  ): Promise<Question[]> => {
    const prisma = getPrisma();
    const season = await requireCurrentSeason();
    const draft = await getDraftWeek(season.id);
    if (!draft) {
      throw new Error("No draft week exists. Call getDraftQuestions first.");
    }

    const suggestion = await prisma.questionSuggestion.findUnique({
      where: { id: suggestionId },
    });
    if (!suggestion) {
      throw new Error(`Unknown suggestion id "${suggestionId}".`);
    }

    // Verify the target slot belongs to the draft week.
    const question = await prisma.question.findFirst({
      where: { id: draftQuestionId, weekId: draft.id },
    });
    if (!question) {
      throw new Error(`Unknown draft question id "${draftQuestionId}".`);
    }

    // Snapshot the suggestion text into the slot and consume the suggestion
    // atomically.
    await prisma.$transaction(async (tx) => {
      await tx.question.update({
        where: { id: draftQuestionId },
        data: { text: suggestion.text },
      });
      await tx.questionSuggestion.delete({ where: { id: suggestionId } });
    });

    const updated = await prisma.question.findMany({
      where: { weekId: draft.id },
      orderBy: { orderIndex: "asc" },
    });

    return updated.map((q) => ({
      id: q.id,
      orderIndex: q.orderIndex,
      text: q.text,
    }));
  };

  // -------------------------------------------------------------------------
  // Method: removeSuggestion
  //
  // Week-agnostic hard delete. A missing row surfaces as Prisma's P2025
  // ("record to delete does not exist"); we duck-type it (mirroring isP2002)
  // and rethrow a clear message.
  // -------------------------------------------------------------------------

  /** Duck-typed Prisma record-not-found (P2025) detection, no namespace import. */
  const isP2025 = (err: unknown): boolean =>
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2025";

  const removeSuggestion = async (suggestionId: string): Promise<void> => {
    const prisma = getPrisma();
    try {
      await prisma.questionSuggestion.delete({ where: { id: suggestionId } });
    } catch (err: unknown) {
      if (isP2025(err)) {
        throw new Error(`Unknown suggestion id "${suggestionId}".`);
      }
      throw err;
    }
  };

  // -------------------------------------------------------------------------
  // Return the GameService interface
  // -------------------------------------------------------------------------

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
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export const dbGameService: GameService = createDbGameService();
