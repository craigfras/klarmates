/**
 * Demo fixtures for the Engineer Guessing Game.
 *
 * A small, coherent in-memory dataset used to drive the app in development and
 * tests: a roster of engineers, one OPEN week of icebreaker questions, a couple
 * of head-to-head matchups, and a player sitting out on a bye.
 *
 * Invariants honoured (see fixtures.test.ts):
 * - the OPEN week has exactly four questions with orderIndex {0,1,2,3}
 * - every matchup references real, distinct player ids in the current week
 * - a matchup's `answeredBy` only ever contains its two participants
 * - `byePlayerIds` is disjoint from every matchup's participants
 */

import type {
  HistoryEntry,
  LeaderboardSeedRow,
  Player,
  Question,
  StoredAnswer,
  StoredAnswerOption,
  WeekStatus,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FixtureMatchup = {
  id: string;
  weekId: string;
  playerAId: string;
  playerBId: string;
  /** Ids of the matchup participants who have submitted their answers. */
  answeredBy: string[];
  /** Set once both participants have answered and guessing opens. */
  guessingUnlockedAt?: string;
};

type FixtureWeek = {
  id: string;
  /** ISO 8601 start date-time of the week (the Monday it begins). */
  startsAt: string;
  status: WeekStatus;
  questions: Question[];
};

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

const EMAIL_DOMAIN = "getklar.com";

const makeEmail = (handle: string): string => `${handle}@${EMAIL_DOMAIN}`;

export const players: Player[] = [
  {
    id: "player-ada",
    name: "Ada Lovelace",
    email: makeEmail("ada"),
    isAdmin: true,
    active: true,
  },
  {
    id: "player-linus",
    name: "Linus Bytes",
    email: makeEmail("linus"),
    isAdmin: false,
    active: true,
  },
  {
    id: "player-grace",
    name: "Grace Hopper",
    email: makeEmail("grace"),
    isAdmin: false,
    active: true,
  },
  {
    id: "player-dennis",
    name: "Dennis Ritchie",
    email: makeEmail("dennis"),
    isAdmin: false,
    active: true,
  },
  {
    id: "player-margaret",
    name: "Margaret Hamilton",
    email: makeEmail("margaret"),
    isAdmin: false,
    active: true,
  },
];

// ---------------------------------------------------------------------------
// Current week
// ---------------------------------------------------------------------------

const QUESTIONS: Question[] = [
  {
    id: "q-first-language",
    orderIndex: 0,
    text: "What was the first programming language you ever learned?",
  },
  {
    id: "q-debug-snack",
    orderIndex: 1,
    text: "What's your go-to snack during a late-night debugging session?",
  },
  {
    id: "q-editor",
    orderIndex: 2,
    text: "Which code editor or IDE could you never give up?",
  },
  {
    id: "q-side-project",
    orderIndex: 3,
    text: "What side project are you secretly proud of?",
  },
];

/** Monday that week 2026-25 begins (drives the home eyebrow date). */
const CURRENT_WEEK_STARTS_AT = "2026-06-22T00:00:00.000Z";

export const currentWeek: FixtureWeek = {
  id: "week-2026-25",
  startsAt: CURRENT_WEEK_STARTS_AT,
  status: "open",
  questions: QUESTIONS,
};

// ---------------------------------------------------------------------------
// Matchups & byes
// ---------------------------------------------------------------------------

export const matchups: FixtureMatchup[] = [
  {
    id: "matchup-ada-linus",
    weekId: currentWeek.id,
    playerAId: "player-ada",
    playerBId: "player-linus",
    // Both answered → guessing is unlocked, making the home page interesting.
    answeredBy: ["player-ada", "player-linus"],
  },
  {
    id: "matchup-grace-dennis",
    weekId: currentWeek.id,
    playerAId: "player-grace",
    playerBId: "player-dennis",
    // Only one side has answered → still awaiting the opponent.
    answeredBy: ["player-grace"],
  },
];

export const byePlayerIds: string[] = ["player-margaret"];

// ---------------------------------------------------------------------------
// Seed answers & options
// ---------------------------------------------------------------------------

/**
 * The pre-answered players' matchup ids, so seeded answers reference the same
 * matchup their participant belongs to.
 */
const MATCHUP_ADA_LINUS = "matchup-ada-linus";
const MATCHUP_GRACE_DENNIS = "matchup-grace-dennis";

/**
 * Builds one stored answer plus its four options for a pre-answered player.
 * Index 0 is the real answer (isCorrect), followed by three distractors. Ids are
 * readable seed strings — getGuessSheet/submitGuess work off relationships, not
 * id text.
 */
const seedAnswer = (
  matchupId: string,
  playerId: string,
  questionId: string,
  realText: string,
  distractors: [string, string, string],
): { answer: StoredAnswer; options: StoredAnswerOption[] } => {
  const answerId = `seed-${playerId}-${questionId}`;
  const answer: StoredAnswer = {
    id: answerId,
    matchupId,
    questionId,
    playerId,
    text: realText,
  };
  const options: StoredAnswerOption[] = [
    { id: `${answerId}-opt-0`, text: realText, isCorrect: true, answerId },
    ...distractors.map((text, index) => ({
      id: `${answerId}-opt-${index + 1}`,
      text,
      isCorrect: false,
      answerId,
    })),
  ];
  return { answer, options };
};

/**
 * Real answers + three plausible distractors for each pre-answered player across
 * the four questions. Distractors share form/length with the real answer and are
 * distinct from it.
 */
const SEED_SPECS: {
  matchupId: string;
  playerId: string;
  questionId: string;
  realText: string;
  distractors: [string, string, string];
}[] = [
  // --- Ada (matchup-ada-linus) ---
  {
    matchupId: MATCHUP_ADA_LINUS,
    playerId: "player-ada",
    questionId: "q-first-language",
    realText: "Assembly on a mainframe",
    distractors: [
      "BASIC on a home computer",
      "Pascal at university",
      "Fortran on punch cards",
    ],
  },
  {
    matchupId: MATCHUP_ADA_LINUS,
    playerId: "player-ada",
    questionId: "q-debug-snack",
    realText: "Black coffee, no snacks",
    distractors: [
      "A fresh pot of tea",
      "Cold leftover pizza",
      "Dark chocolate squares",
    ],
  },
  {
    matchupId: MATCHUP_ADA_LINUS,
    playerId: "player-ada",
    questionId: "q-editor",
    realText: "Emacs, naturally",
    distractors: ["Vim until I die", "VS Code, obviously", "Sublime Text, always"],
  },
  {
    matchupId: MATCHUP_ADA_LINUS,
    playerId: "player-ada",
    questionId: "q-side-project",
    realText: "A poetry-generating algorithm",
    distractors: [
      "A toy operating-system kernel",
      "A self-hosting compiler",
      "A music-composing neural net",
    ],
  },
  // --- Linus (matchup-ada-linus) ---
  {
    matchupId: MATCHUP_ADA_LINUS,
    playerId: "player-linus",
    questionId: "q-first-language",
    realText: "C, of course",
    distractors: ["Assembly, obviously", "Pascal, sadly", "BASIC, regrettably"],
  },
  {
    matchupId: MATCHUP_ADA_LINUS,
    playerId: "player-linus",
    questionId: "q-debug-snack",
    realText: "Cold leftover pizza",
    distractors: [
      "Black coffee, no snacks",
      "A fresh pot of tea",
      "Salted peanuts by the handful",
    ],
  },
  {
    matchupId: MATCHUP_ADA_LINUS,
    playerId: "player-linus",
    questionId: "q-editor",
    realText: "Vim until I die",
    distractors: ["Emacs, naturally", "Nano for life", "VS Code, obviously"],
  },
  {
    matchupId: MATCHUP_ADA_LINUS,
    playerId: "player-linus",
    questionId: "q-side-project",
    realText: "A toy operating-system kernel",
    distractors: [
      "A poetry-generating algorithm",
      "A self-hosting compiler",
      "A distributed key-value store",
    ],
  },
  // --- Grace (matchup-grace-dennis) ---
  {
    matchupId: MATCHUP_GRACE_DENNIS,
    playerId: "player-grace",
    questionId: "q-first-language",
    realText: "COBOL — I basically wrote it",
    distractors: [
      "FLOW-MATIC — I prototyped it",
      "Fortran — I tolerated it",
      "Assembly — I escaped it",
    ],
  },
  {
    matchupId: MATCHUP_GRACE_DENNIS,
    playerId: "player-grace",
    questionId: "q-debug-snack",
    realText: "A fresh pot of tea",
    distractors: [
      "Black coffee, no snacks",
      "Cold leftover pizza",
      "A plate of shortbread",
    ],
  },
  {
    matchupId: MATCHUP_GRACE_DENNIS,
    playerId: "player-grace",
    questionId: "q-editor",
    realText: "Whatever compiles cleanly",
    distractors: ["Emacs, naturally", "Vim until I die", "VS Code, obviously"],
  },
  {
    matchupId: MATCHUP_GRACE_DENNIS,
    playerId: "player-grace",
    questionId: "q-side-project",
    realText: "A self-hosting compiler",
    distractors: [
      "A poetry-generating algorithm",
      "A toy operating-system kernel",
      "A nautical navigation library",
    ],
  },
];

const SEEDED = SEED_SPECS.map((spec) =>
  seedAnswer(
    spec.matchupId,
    spec.playerId,
    spec.questionId,
    spec.realText,
    spec.distractors,
  ),
);

export const seedAnswers: StoredAnswer[] = SEEDED.map((s) => s.answer);
export const seedAnswerOptions: StoredAnswerOption[] = SEEDED.flatMap(
  (s) => s.options,
);

// ---------------------------------------------------------------------------
// Leaderboard seed
// ---------------------------------------------------------------------------

/**
 * Seeded standings for all five players across both scopes.
 *
 * Season: Ada & Linus tie on total 5 — Ada ranks first on correctGuesses (4>3).
 * All-time: Grace tops the board with total 20.
 */
export const leaderboardSeed: LeaderboardSeedRow[] = [
  {
    playerId: "player-ada",
    season: { total: 5, correctGuesses: 4 },
    allTime: { total: 18, correctGuesses: 15 },
  },
  {
    playerId: "player-linus",
    season: { total: 5, correctGuesses: 3 },
    allTime: { total: 16, correctGuesses: 12 },
  },
  {
    playerId: "player-grace",
    season: { total: 4, correctGuesses: 4 },
    allTime: { total: 20, correctGuesses: 16 },
  },
  {
    playerId: "player-dennis",
    season: { total: 3, correctGuesses: 2 },
    allTime: { total: 9, correctGuesses: 6 },
  },
  {
    playerId: "player-margaret",
    season: { total: 1, correctGuesses: 0 },
    allTime: { total: 7, correctGuesses: 4 },
  },
];

// ---------------------------------------------------------------------------
// History seed
// ---------------------------------------------------------------------------

/** A prior, closed week used to give players some head-to-head history. */
const PRIOR_WEEK_ID = "week-2026-24";

/** The Monday that the prior week (week-2026-24) begins. */
const PRIOR_WEEK_STARTS_AT = "2026-06-08T00:00:00.000Z";

/** Per-player past recaps keyed by player id. */
export const historySeed: Record<string, HistoryEntry[]> = {
  "player-ada": [
    {
      weekId: PRIOR_WEEK_ID,
      startsAt: PRIOR_WEEK_STARTS_AT,
      opponentName: "Grace Hopper",
      recap: { meCorrect: 3, opponentCorrect: 2, questionCount: 4 },
    },
  ],
  "player-linus": [
    {
      weekId: PRIOR_WEEK_ID,
      startsAt: PRIOR_WEEK_STARTS_AT,
      opponentName: "Dennis Ritchie",
      recap: { meCorrect: 4, opponentCorrect: 4, questionCount: 4 },
    },
  ],
  "player-grace": [
    {
      weekId: PRIOR_WEEK_ID,
      startsAt: PRIOR_WEEK_STARTS_AT,
      opponentName: "Ada Lovelace",
      recap: { meCorrect: 2, opponentCorrect: 3, questionCount: 4 },
    },
  ],
};
