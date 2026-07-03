/**
 * Shared in-process mock store.
 *
 * In the running Next.js app, Route Handlers and Server Components are compiled
 * into separate server bundles, so each gets its own module instance of
 * `gameService.ts` and the fixtures it closes over. To keep the mutable mock
 * state (answers, `answeredBy`, …) consistent across those bundles, the store
 * is seeded once and cached on `globalThis` — a single process-wide instance
 * every module instance reads from and writes to.
 */

import {
  players,
  currentWeek,
  matchups,
  byePlayerIds,
  seedAnswers,
  seedAnswerOptions,
  leaderboardSeed,
  historySeed,
} from "@/lib/fixtures";
import type { GameServiceData } from "@/lib/services/gameService";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MOCK_STORE_KEY = "__eggMockStore__";

/**
 * The seeded store always owns its mutable answer collections, so they are
 * non-optional here even though `createMockGameService` accepts them optionally.
 */
type MockStore = GameServiceData &
  Required<
    Pick<
      GameServiceData,
      "answers" | "answerOptions" | "guesses" | "weeklyScores" | "recaps"
    >
  >;

type GlobalWithStore = typeof globalThis & {
  [MOCK_STORE_KEY]?: MockStore;
};

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

/**
 * Builds a fresh store from a DEEP COPY of the fixtures so the pristine fixture
 * consts are never mutated as players submit answers in-process.
 */
const seedStore = (): MockStore => ({
  players: structuredClone(players),
  currentWeek: structuredClone(currentWeek),
  matchups: structuredClone(matchups),
  byePlayerIds: structuredClone(byePlayerIds),
  answers: structuredClone(seedAnswers),
  answerOptions: structuredClone(seedAnswerOptions),
  guesses: [],
  leaderboard: structuredClone(leaderboardSeed),
  history: structuredClone(historySeed),
  weeklyScores: [],
  recaps: [],
});

// ---------------------------------------------------------------------------
// Accessor
// ---------------------------------------------------------------------------

/**
 * Lazily seeds and caches the store on `globalThis`, returning the one shared
 * instance for every module instance in the process.
 */
export const getMockStore = (): MockStore => {
  const g = globalThis as GlobalWithStore;
  if (g[MOCK_STORE_KEY] === undefined) {
    g[MOCK_STORE_KEY] = seedStore();
  }
  return g[MOCK_STORE_KEY];
};
