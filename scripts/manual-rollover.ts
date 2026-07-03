/**
 * Manual test harness for Slice 14 season rollover (throwaway — delete when done).
 *
 *   npx tsx scripts/manual-rollover.ts
 *
 * Requires .env.local with DATABASE_URL (USE_MOCK is irrelevant — this calls the
 * DB-backed default deps directly). It MUTATES the DB: flips the current season
 * off-current and creates the next quarter. Run against a dev DB, never prod.
 *
 * Proves the spec's verifiable outcomes:
 *   - crossing the boundary creates exactly ONE new current season
 *   - a re-run is idempotent (no duplicate)
 *   - historical weekly_scores + matchups are untouched (derived, not destructive)
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { getPrisma } from "@/lib/db/client";
import { rolloverSeasonIfDue } from "@/lib/jobs";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const prisma = getPrisma();
  try {
    const current = await prisma.season.findFirst({ where: { isCurrent: true } });
    if (!current) throw new Error("No current season — run `npm run db:seed` first.");

    // A "today" one day after the current season ends → rollover is due.
    const today = new Date(current.endsOn.getTime() + ONE_DAY_MS);

    const [scoresBefore, matchupsBefore, seasonsBefore] = await Promise.all([
      prisma.weeklyScore.count(),
      prisma.matchup.count(),
      prisma.season.count(),
    ]);

    console.log("BEFORE:", {
      currentSeason: { name: current.name, endsOn: current.endsOn, id: current.id },
      seasons: seasonsBefore,
      weeklyScores: scoresBefore,
      matchups: matchupsBefore,
      simulatedToday: today.toISOString(),
    });

    const first = await rolloverSeasonIfDue(today);
    console.log("ROLLOVER #1:", first);

    // Re-run with the SAME date: the new current season now ends in the future
    // relative to `today`, so this must no-op (idempotency / no duplicate).
    const second = await rolloverSeasonIfDue(today);
    console.log("ROLLOVER #2 (idempotency):", second);

    const [scoresAfter, matchupsAfter, currentSeasons, allSeasons] = await Promise.all([
      prisma.weeklyScore.count(),
      prisma.matchup.count(),
      prisma.season.findMany({ where: { isCurrent: true } }),
      prisma.season.findMany({ orderBy: { startsOn: "asc" } }),
    ]);

    console.log("AFTER:", {
      seasons: allSeasons.map((s) => ({ name: s.name, isCurrent: s.isCurrent })),
      currentCount: currentSeasons.length, // must be exactly 1
      weeklyScores: scoresAfter, // must equal scoresBefore (non-destructive)
      matchups: matchupsAfter, // must equal matchupsBefore (non-destructive)
    });

    const ok =
      first.rolledOver &&
      !second.rolledOver &&
      currentSeasons.length === 1 &&
      scoresAfter === scoresBefore &&
      matchupsAfter === matchupsBefore;
    console.log(ok ? "\n✅ PASS" : "\n❌ FAIL — check the deltas above");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
