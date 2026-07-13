/**
 * One-off DESTRUCTIVE reset to a "first week" game state (ops utility — not
 * part of the app).
 *
 * Wipes ALL played gameplay data but PRESERVES the roster, seasons, and the
 * standing question-suggestion pool. It then leaves the database ready for a
 * fresh first week: a single draft week in `awaiting_approval` status, starting
 * Monday 2026-07-13, pre-filled with freshly generated (unapproved) questions.
 * An admin approves those questions to open the week via the normal flow.
 *
 * KEPT:    players, seasons, question_suggestions
 * CLEARED: guesses, answer_options, answers, weekly_scores, matchups,
 *          week_participants, questions, weeks
 *
 * Safety: refuses to run unless CONFIRM_RESET=yes is set, so it can never fire
 * by accident. Connects to whatever DATABASE_URL is in .env.local / the process
 * environment — point that at the intended database before running.
 *
 *   CONFIRM_RESET=yes npx tsx scripts/reset-first-week.ts
 */

import { config as loadEnv } from "dotenv";

// Load .env.local (Next.js convention) then .env before the client reads
// DATABASE_URL. Missing files are a no-op.
loadEnv({ path: ".env.local" });
loadEnv();

import { getPrisma } from "@/lib/db/client";
import { defaultQuestionGenerator } from "@/lib/ai";
import { WEEKLY_QUESTION_COUNT } from "@/lib/types";

// ---------------------------------------------------------------------------
// First-week baseline
// ---------------------------------------------------------------------------

/** Status a freshly generated (not-yet-opened) week sits in for admin review. */
const AWAITING_APPROVAL = "awaiting_approval" as const;

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The requested first-week start (Monday) and its derived one-week end. */
const FIRST_WEEK_STARTS_AT = new Date("2026-07-13T00:00:00.000Z");
const FIRST_WEEK_ENDS_AT = new Date(
  FIRST_WEEK_STARTS_AT.getTime() + ONE_WEEK_MS,
);

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
    const season = await prisma.season.findFirst({
      where: { isCurrent: true },
      select: { id: true, name: true },
    });
    if (!season) {
      throw new Error("No current season; run `npm run db:seed` first.");
    }

    // Generate the first week's questions up front (network) via the default
    // generator — falls back to the deterministic stub when no AI key is set,
    // matching the normal getDraftQuestions creation path.
    const texts = await defaultQuestionGenerator.generateQuestions(
      WEEKLY_QUESTION_COUNT,
    );

    // Wipe gameplay children-before-parents (FK-safe), then create the fresh
    // first draft week — all in one transaction so we never leave a half-reset
    // database behind. Players, seasons and question_suggestions are untouched.
    await prisma.$transaction([
      prisma.guess.deleteMany(),
      prisma.answerOption.deleteMany(),
      prisma.answer.deleteMany(),
      prisma.weeklyScore.deleteMany(),
      prisma.matchup.deleteMany(),
      prisma.weekParticipant.deleteMany(),
      prisma.question.deleteMany(),
      prisma.week.deleteMany(),
      prisma.week.create({
        data: {
          seasonId: season.id,
          startsAt: FIRST_WEEK_STARTS_AT,
          endsAt: FIRST_WEEK_ENDS_AT,
          status: AWAITING_APPROVAL,
          questions: {
            create: texts.map((text, i) => ({
              orderIndex: i,
              text,
              approved: false,
            })),
          },
        },
      }),
    ]);

    const [players, suggestions, weeks, questions] = await Promise.all([
      prisma.player.count(),
      prisma.questionSuggestion.count(),
      prisma.week.count(),
      prisma.question.count(),
    ]);
    // eslint-disable-next-line no-console
    console.log(
      `Reset complete: kept ${players} player(s) and ${suggestions} suggestion(s). ` +
        `Season "${season.name}" now has ${weeks} week (awaiting_approval, ` +
        `starts ${FIRST_WEEK_STARTS_AT.toISOString().slice(0, 10)}) with ` +
        `${questions} unapproved question(s). Approve them to open the week.`,
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
