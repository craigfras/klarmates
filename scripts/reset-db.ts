/**
 * One-off DESTRUCTIVE database reset (ops utility — not part of the app).
 *
 * Wipes ALL game data and ALL players, then leaves the database in a clean
 * baseline: a single admin player (craig.f@getklar.com) and one current season.
 * Weeks, questions, matchups, answers, guesses, scores and suggestions are all
 * removed.
 *
 * Safety: refuses to run unless CONFIRM_RESET=yes is set, so it can never fire
 * by accident. Connects to whatever DATABASE_URL is in .env.local / the process
 * environment — point that at the intended database before running.
 *
 *   CONFIRM_RESET=yes npx tsx scripts/reset-db.ts
 */

import { config as loadEnv } from "dotenv";

// Load .env.local (Next.js convention) then .env before the client reads
// DATABASE_URL. Missing files are a no-op.
loadEnv({ path: ".env.local" });
loadEnv();

import { getPrisma } from "@/lib/db/client";

// ---------------------------------------------------------------------------
// Baseline the reset restores
// ---------------------------------------------------------------------------

const ADMIN = {
  email: "craig.f@getklar.com",
  name: "Craig F",
  isAdmin: true,
  active: true,
};

/** The current quarterly season window (mirrors lib/db/seed.ts). */
const CURRENT_SEASON = {
  name: "2026 Q3",
  startsOn: new Date("2026-07-01T00:00:00.000Z"),
  endsOn: new Date("2026-09-30T00:00:00.000Z"),
  isCurrent: true,
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (process.env.CONFIRM_RESET !== "yes") {
    // eslint-disable-next-line no-console
    console.error(
      "Refusing to run: set CONFIRM_RESET=yes to confirm this DESTRUCTIVE reset.",
    );
    process.exit(1);
  }

  const prisma = getPrisma();

  try {
    // Delete children before parents (FK-safe), then all players and seasons.
    await prisma.$transaction([
      prisma.guess.deleteMany(),
      prisma.answerOption.deleteMany(),
      prisma.answer.deleteMany(),
      prisma.weeklyScore.deleteMany(),
      prisma.matchup.deleteMany(),
      prisma.weekParticipant.deleteMany(),
      prisma.question.deleteMany(),
      prisma.questionSuggestion.deleteMany(),
      prisma.week.deleteMany(),
      prisma.season.deleteMany(),
      prisma.player.deleteMany(),
      // Recreate the clean baseline.
      prisma.player.create({ data: ADMIN }),
      prisma.season.create({ data: CURRENT_SEASON }),
    ]);

    const [players, admins, seasons] = await Promise.all([
      prisma.player.count(),
      prisma.player.count({ where: { isAdmin: true } }),
      prisma.season.count(),
    ]);
    // eslint-disable-next-line no-console
    console.log(
      `Reset complete: ${players} player(s) (${admins} admin), ${seasons} season(s). ` +
        `All weeks/questions/matchups/answers/guesses/scores/suggestions cleared.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
