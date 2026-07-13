/**
 * Repairs corrupted answer_options rows (ops utility — not part of the app).
 *
 * Background: a bug in `parseGeneratedList` (lib/ai.ts, now fixed) shredded
 * truncated JSON model output line-by-line, so JSON scaffolding fragments
 * ("{", '"distractors": [', '"...",') leaked in as distractor options. This
 * script regenerates fresh distractors for each affected answer using the
 * now-fixed generator and replaces ONLY the incorrect options — the correct
 * option (the real answer) is left untouched.
 *
 * Mirrors production's option-creation logic in dbGameService.ts exactly:
 * deterministic ids `${answerId}-opt-N`, distractors sliced to DISTRACTOR_COUNT.
 *
 * SAFETY:
 *   - Dry-run by default. Set CONFIRM_REPAIR=yes to actually write.
 *   - Skips any answer whose incorrect options already have guesses pointing at
 *     them (never rewrites options a player has acted on).
 *   - Connects to whatever DATABASE_URL is in .env.local / the environment.
 *
 *   npx tsx scripts/repair-corrupted-options.ts                 # dry-run
 *   CONFIRM_REPAIR=yes npx tsx scripts/repair-corrupted-options.ts   # apply
 */

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

import { getPrisma } from "@/lib/db/client";
import { DISTRACTOR_COUNT, defaultDistractorGenerator } from "@/lib/ai";
import { isCorruptText } from "./corruptOptions";

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const apply = process.env.CONFIRM_REPAIR === "yes";
  const prisma = getPrisma();

  try {
    // Find every incorrect (distractor) option whose text is JSON scaffolding,
    // with the answer/question context needed to regenerate, plus any guesses
    // that chose it (a repair must never touch an option a player acted on).
    const corruptOptions = (
      await prisma.answerOption.findMany({
        where: { isCorrect: false },
        select: {
          id: true,
          text: true,
          answerId: true,
          guesses: { select: { id: true } },
        },
      })
    ).filter((option) => isCorruptText(option.text));

    if (corruptOptions.length === 0) {
      // eslint-disable-next-line no-console
      console.log("No corrupted distractor options found. Nothing to repair.");
      return;
    }

    const affectedAnswerIds = [
      ...new Set(corruptOptions.map((option) => option.answerId)),
    ];

    // eslint-disable-next-line no-console
    console.log(
      `Found ${corruptOptions.length} corrupt option(s) across ` +
        `${affectedAnswerIds.length} answer(s). Mode: ${apply ? "APPLY" : "DRY-RUN"}.\n`,
    );

    let repaired = 0;
    let skipped = 0;

    for (const answerId of affectedAnswerIds) {
      const answer = await prisma.answer.findUnique({
        where: { id: answerId },
        select: {
          id: true,
          text: true,
          question: { select: { text: true } },
          options: {
            select: {
              id: true,
              isCorrect: true,
              guesses: { select: { id: true } },
            },
          },
        },
      });

      if (!answer) {
        // eslint-disable-next-line no-console
        console.warn(`  answer ${answerId}: not found — skipping.`);
        skipped += 1;
        continue;
      }

      const incorrectOptions = answer.options.filter((o) => !o.isCorrect);
      const guessesOnIncorrect = incorrectOptions.reduce(
        (n, o) => n + o.guesses.length,
        0,
      );

      // Never rewrite an option a player has already guessed on.
      if (guessesOnIncorrect > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `  answer ${answerId}: ${guessesOnIncorrect} guess(es) on its ` +
            `distractors — skipping to preserve gameplay history.`,
        );
        skipped += 1;
        continue;
      }

      // Regenerate distractors exactly as production does.
      const distractors = await defaultDistractorGenerator.generateDistractors(
        answer.question.text,
        answer.text,
      );
      const limited = distractors.slice(0, DISTRACTOR_COUNT);

      // eslint-disable-next-line no-console
      console.log(
        `  answer ${answerId} (${JSON.stringify(answer.text)}):\n` +
          `    new distractors: ${limited.map((t) => JSON.stringify(t)).join(", ")}`,
      );

      if (!apply) {
        continue;
      }

      // Replace incorrect options atomically: delete the corrupt ones, insert
      // the fresh set with deterministic ids `${answerId}-opt-N` (opt-0 is the
      // correct option and is left untouched).
      await prisma.$transaction([
        prisma.answerOption.deleteMany({
          where: { answerId, isCorrect: false },
        }),
        prisma.answerOption.createMany({
          data: limited.map((text, index) => ({
            id: `${answerId}-opt-${index + 1}`,
            answerId,
            text,
            isCorrect: false,
          })),
        }),
      ]);
      repaired += 1;
    }

    // eslint-disable-next-line no-console
    console.log(
      `\n${apply ? "Repaired" : "Would repair"} ${apply ? repaired : affectedAnswerIds.length - skipped} answer(s); ` +
        `skipped ${skipped}.` +
        (apply ? "" : "\nRe-run with CONFIRM_REPAIR=yes to apply."),
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
