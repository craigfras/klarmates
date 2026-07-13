/**
 * READ-ONLY investigation of corrupted answer_options rows (ops utility — not
 * part of the app).
 *
 * Background: a bug in `parseGeneratedList` (lib/ai.ts) shredded truncated JSON
 * model output line-by-line, so JSON scaffolding fragments ("{", '"distractors": [',
 * '"...",') leaked in as distractor options. This script finds those rows,
 * reports the scope, and — crucially — flags any that already have guesses
 * pointing at them, so we know what a repair can safely touch.
 *
 * Makes NO writes. Connects to whatever DATABASE_URL is in .env.local / the
 * process environment — point that at the intended database before running.
 *
 *   npx tsx scripts/inspect-corrupted-options.ts
 */

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

import { getPrisma } from "@/lib/db/client";
import { isCorruptText } from "./corruptOptions";

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const prisma = getPrisma();

  try {
    // Pull every INCORRECT option (distractors only — the correct option is the
    // real answer and is never regenerated) with its answer/question/week/player
    // context and any guesses that chose it.
    const options = await prisma.answerOption.findMany({
      where: { isCorrect: false },
      select: {
        id: true,
        text: true,
        answerId: true,
        answer: {
          select: {
            id: true,
            text: true,
            player: { select: { name: true } },
            question: {
              select: {
                id: true,
                text: true,
                week: { select: { id: true, status: true, startsAt: true } },
              },
            },
          },
        },
        guesses: { select: { id: true } },
      },
    });

    const corrupt = options.filter((option) => isCorruptText(option.text));

    if (corrupt.length === 0) {
      // eslint-disable-next-line no-console
      console.log("No corrupted distractor options found. Nothing to repair.");
      return;
    }

    // Group corrupt options by the answer they belong to.
    const byAnswer = new Map<string, typeof corrupt>();
    for (const option of corrupt) {
      const list = byAnswer.get(option.answerId) ?? [];
      list.push(option);
      byAnswer.set(option.answerId, list);
    }

    const guessedCorrupt = corrupt.filter((o) => o.guesses.length > 0);
    const weeks = new Set(corrupt.map((o) => o.answer.question.week.id));

    // eslint-disable-next-line no-console
    console.log(
      `\n=== SCOPE ===\n` +
        `Corrupt distractor options : ${corrupt.length}\n` +
        `Affected answers           : ${byAnswer.size}\n` +
        `Affected weeks             : ${weeks.size}\n` +
        `Corrupt options with guesses on them : ${guessedCorrupt.length}\n`,
    );

    // eslint-disable-next-line no-console
    console.log("=== DISTINCT CORRUPT TEXT VALUES ===");
    const counts = new Map<string, number>();
    for (const o of corrupt) {
      counts.set(o.text, (counts.get(o.text) ?? 0) + 1);
    }
    for (const [text, count] of [...counts.entries()].sort(
      (a, b) => b[1] - a[1],
    )) {
      // eslint-disable-next-line no-console
      console.log(`  ${count.toString().padStart(3)} × ${JSON.stringify(text)}`);
    }

    // eslint-disable-next-line no-console
    console.log("\n=== PER-ANSWER DETAIL ===");
    for (const [answerId, opts] of byAnswer) {
      const { answer } = opts[0];
      const guessedHere = opts.reduce((n, o) => n + o.guesses.length, 0);
      // eslint-disable-next-line no-console
      console.log(
        `\nanswer ${answerId} — week ${answer.question.week.id} (${answer.question.week.status})\n` +
          `  player   : ${answer.player.name}\n` +
          `  question : ${JSON.stringify(answer.question.text)}\n` +
          `  real ans : ${JSON.stringify(answer.text)}\n` +
          `  corrupt  : ${opts.map((o) => JSON.stringify(o.text)).join(", ")}\n` +
          `  guesses on corrupt options here: ${guessedHere}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
