/**
 * Probes the live distractor generator (ops utility — not part of the app).
 *
 * Verifies that Gemini distractor generation actually works end-to-end with the
 * configured GEMINI_API_KEY + GEMINI_MODEL, WITHOUT touching production data.
 * It calls the same `defaultDistractorGenerator` production uses, then compares
 * the result against the deterministic canned stub for the same input:
 *
 *   - Output DIFFERS from the stub  → the real model responded. ✅
 *   - Output EQUALS the stub        → every call fell back to the stub. ❌
 *     (wrong/unavailable model id, bad key, quota, or parse/dedupe failures)
 *
 * Reads DATABASE_URL/GEMINI_* from .env.local / the environment, but makes no
 * DB connection and no writes anywhere.
 *
 *   npx tsx scripts/probe-distractors.ts
 */

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

import {
  GEMINI_MODEL,
  defaultDistractorGenerator,
  stubDistractorGenerator,
} from "@/lib/ai";

// ---------------------------------------------------------------------------
// Sample inputs (topically distinct so a real model's output is obviously
// on-topic per question, unlike the stub's fixed programming-language pool).
// ---------------------------------------------------------------------------

const SAMPLES: { question: string; realAnswer: string }[] = [
  {
    question: "What's your go-to snack during a late-night debugging session?",
    realAnswer: "Cold leftover pizza",
  },
  {
    question: "What specific smell instantly makes you feel nostalgic?",
    realAnswer: "Fresh-cut grass",
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** Set equality, case-insensitive, order-independent. */
const sameSet = (a: string[], b: string[]): boolean => {
  const norm = (xs: string[]) =>
    new Set(xs.map((x) => x.trim().toLowerCase()));
  const sa = norm(a);
  const sb = norm(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
};

async function main(): Promise<void> {
  const hasKey = Boolean(process.env.GEMINI_API_KEY);

  // eslint-disable-next-line no-console
  console.log(
    `GEMINI_MODEL = ${GEMINI_MODEL}\n` +
      `GEMINI_API_KEY present: ${hasKey}\n` +
      (hasKey
        ? ""
        : "⚠️  No key set — the generator uses the stub BY DESIGN; this probe cannot confirm the model.\n"),
  );

  let realResponses = 0;

  for (const { question, realAnswer } of SAMPLES) {
    const [live, stub] = await Promise.all([
      defaultDistractorGenerator.generateDistractors(question, realAnswer),
      stubDistractorGenerator.generateDistractors(question, realAnswer),
    ]);

    const fellBack = sameSet(live, stub);
    if (!fellBack) {
      realResponses += 1;
    }

    // eslint-disable-next-line no-console
    console.log(
      `Q: ${JSON.stringify(question)}\n` +
        `  real answer: ${JSON.stringify(realAnswer)}\n` +
        `  live distractors: ${live.map((t) => JSON.stringify(t)).join(", ")}\n` +
        `  stub would give:  ${stub.map((t) => JSON.stringify(t)).join(", ")}\n` +
        `  → ${fellBack ? "❌ FELL BACK TO STUB" : "✅ real model responded"}\n`,
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    hasKey && realResponses === SAMPLES.length
      ? "PASS: Gemini generation is working for every sample."
      : hasKey
        ? "FAIL: at least one sample fell back to the stub — the model path is broken."
        : "INCONCLUSIVE: set GEMINI_API_KEY to probe the real model.",
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
