/**
 * AI generation seams.
 *
 * Guessing needs plausible wrong options to sit alongside each real answer, and
 * the admin flow needs icebreaker questions generated for each week. This module
 * defines the `DistractorGenerator` and `QuestionGenerator` contracts and their
 * deterministic stubs used in development and tests. Real LLM-backed generators
 * can later implement the same interfaces without touching callers.
 *
 * Slice 11 adds the Gemini-backed seam: tolerant parsing, validation/dedupe,
 * retry-once-then-fallback generator factories, a lazily-loaded real SDK
 * `complete` function, and env-driven default generators that fall back to the
 * deterministic stubs when no API key is configured.
 */

import { buildQuestionsPrompt, buildDistractorsPrompt } from "@/lib/aiPrompts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Wrong options generated per answer (so each answer has 1 real + 3 wrong). */
export const DISTRACTOR_COUNT = 3;

/** Gemini Flash model for question/distractor generation (config, not inline). */
export const GEMINI_MODEL = "gemini-3.5-flash";

/**
 * Extra attempts after the first when an AI call fails (network or
 * parse/validate). One retry → up to two attempts total before falling back.
 */
export const AI_RETRY_ATTEMPTS = 1;

/** Plausible canned answers the stub draws from before deriving variants. */
const CANNED_DISTRACTORS: string[] = [
  "Python, because it just clicked",
  "JavaScript in a browser console",
  "C, the hard way",
  "Java in a university course",
  "Ruby on a weekend project",
  "Go, for a side service",
  "Rust, after fighting the borrow checker",
  "TypeScript all the way down",
];

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export interface DistractorGenerator {
  generateDistractors(question: string, realAnswer: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Deterministic stub
// ---------------------------------------------------------------------------

/**
 * Seeds an offset into the canned pool from the inputs so different
 * (question, realAnswer) pairs start at different points — keeping output
 * deterministic per input while differing across inputs.
 */
const seedOffset = (question: string, realAnswer: string): number => {
  const source = `${question}::${realAnswer}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
};

/**
 * Picks DISTRACTOR_COUNT distinct, non-empty distractors, none equal to the
 * real answer, deterministically from the canned pool.
 *
 * The pool always holds more than DISTRACTOR_COUNT entries (see CANNED_DISTRACTORS),
 * so even after filtering out a real answer that collides with a pool entry there
 * are enough distinct options to fill the selection — no fallback needed.
 */
const pickDistractors = (question: string, realAnswer: string): string[] => {
  const offset = seedOffset(question, realAnswer);
  const pool = CANNED_DISTRACTORS.filter(
    (candidate) => candidate !== realAnswer,
  );

  const chosen: string[] = [];
  for (
    let step = 0;
    step < pool.length && chosen.length < DISTRACTOR_COUNT;
    step += 1
  ) {
    const candidate = pool[(offset + step) % pool.length];
    if (!chosen.includes(candidate)) {
      chosen.push(candidate);
    }
  }

  return chosen;
};

export const stubDistractorGenerator: DistractorGenerator = {
  generateDistractors: async (question, realAnswer) =>
    pickDistractors(question, realAnswer),
};

// ---------------------------------------------------------------------------
// Question generation contract
// ---------------------------------------------------------------------------

export interface QuestionGenerator {
  generateQuestions(count: number): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Canned question pool
// ---------------------------------------------------------------------------

/**
 * At least 8 distinct workplace-appropriate icebreaker prompts.
 * At least one entry contains the substring "team" (required by tests).
 */
const CANNED_QUESTIONS: string[] = [
  "What's one thing your team would be surprised to learn about you?",
  "What was the first programming language you ever learned?",
  "What's your go-to snack during a late-night debugging session?",
  "Which code editor or IDE could you never give up?",
  "What side project are you secretly proud of?",
  "If you could automate one thing in your daily life, what would it be?",
  "What's the most unusual bug you've ever fixed?",
  "What book, podcast, or resource has most influenced how you work?",
  "What's a skill outside of tech that you bring to your role?",
  "What would your dream dev environment look like?",
];

// ---------------------------------------------------------------------------
// Deterministic stub
// ---------------------------------------------------------------------------

/**
 * Returns the first `count` distinct prompts from the canned pool
 * deterministically. Same count → same result every call.
 * If count exceeds pool size, returns all available distinct prompts.
 */
export const stubQuestionGenerator: QuestionGenerator = {
  generateQuestions: async (count: number): Promise<string[]> =>
    CANNED_QUESTIONS.slice(0, count),
};

// ---------------------------------------------------------------------------
// Convenience export
// ---------------------------------------------------------------------------

/**
 * Convenience function that delegates to `stubQuestionGenerator`.
 * Mirrors the pattern of `generateDistractors` for discoverability.
 */
export const generateQuestions = (count: number): Promise<string[]> =>
  stubQuestionGenerator.generateQuestions(count);

// ===========================================================================
// Gemini-backed generation (slice 11)
// ===========================================================================

// ---------------------------------------------------------------------------
// Completion seam
// ---------------------------------------------------------------------------

/** Produces the model's raw text output for a single prompt. */
export type CompleteFn = (prompt: string) => Promise<string>;

// ---------------------------------------------------------------------------
// Pure helpers: parse / validate / dedupe
// ---------------------------------------------------------------------------

/** Leading list markers / numbering stripped in the newline fallback. */
const LIST_MARKER_PATTERN = /^\s*(?:\d+[.)]|[-*•])\s*/;

/** Surrounding straight/smart quotes stripped in the newline fallback. */
const SURROUNDING_QUOTE_PATTERN = /^["'“”‘’]+|["'“”‘’]+$/g;

/** Narrows an unknown value to an array of strings. */
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * Property names the model is asked to key its JSON array under (see
 * `lib/aiPrompts.ts`). Preferred over a positional "first array" scan so an
 * unexpected extra array-valued field can't be picked up by mistake.
 */
const KNOWN_LIST_KEYS = ["questions", "distractors"] as const;

/** Splits raw text into trimmed, marker/quote-stripped, non-empty lines. */
const parseNewlineList = (raw: string): string[] =>
  raw
    .split("\n")
    .map((line) =>
      line
        .replace(LIST_MARKER_PATTERN, "")
        .replace(SURROUNDING_QUOTE_PATTERN, "")
        .trim(),
    )
    .filter((line) => line.length > 0);

/**
 * Tolerant parser for a model's list output. Tries, in order:
 *   1. A JSON string array (`["a","b"]`).
 *   2. A JSON object — prefers a known list key (`questions` / `distractors`),
 *      then falls back to the first array-valued property.
 *   3. A newline-delimited fallback that strips list markers, numbering, and
 *      surrounding quotes, trims, and drops empty lines.
 */
export const parseGeneratedList = (raw: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isStringArray(parsed)) {
      return parsed;
    }
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      for (const key of KNOWN_LIST_KEYS) {
        if (isStringArray(record[key])) {
          return record[key];
        }
      }
      const firstArray = Object.values(record).find(isStringArray);
      if (firstArray) {
        return firstArray;
      }
    }
  } catch {
    // Not JSON — fall through to the newline-delimited parser below.
  }
  return parseNewlineList(raw);
};

/**
 * Returns the trimmed list iff it has exactly `count` non-empty, distinct
 * items (case-sensitive). Throws otherwise so the caller can retry/fall back.
 */
export const validateQuestions = (
  items: string[],
  count: number,
): string[] => {
  const trimmed = items.map((item) => item.trim());

  if (trimmed.length !== count) {
    throw new Error(
      `Expected ${count} questions, received ${trimmed.length}.`,
    );
  }
  if (trimmed.some((item) => item.length === 0)) {
    throw new Error("Generated questions must all be non-empty.");
  }
  if (new Set(trimmed).size !== trimmed.length) {
    throw new Error("Generated questions must all be distinct.");
  }
  return trimmed;
};

/**
 * Trims, drops case-insensitive matches to `realAnswer`, drops case-insensitive
 * duplicates, then returns exactly DISTRACTOR_COUNT options. Throws when fewer
 * than DISTRACTOR_COUNT usable distractors remain.
 */
export const dedupeDistractors = (
  items: string[],
  realAnswer: string,
): string[] => {
  const realLower = realAnswer.trim().toLowerCase();
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const item of items) {
    const value = item.trim();
    const lower = value.toLowerCase();
    if (value.length === 0 || lower === realLower || seen.has(lower)) {
      continue;
    }
    seen.add(lower);
    kept.push(value);
  }

  if (kept.length < DISTRACTOR_COUNT) {
    throw new Error(
      `Expected at least ${DISTRACTOR_COUNT} distractors, got ${kept.length}.`,
    );
  }
  return kept.slice(0, DISTRACTOR_COUNT);
};

// ---------------------------------------------------------------------------
// Retry-once-then-fallback control flow (shared by both factories)
// ---------------------------------------------------------------------------

/** Injectable collaborators shared by both AI generator factories. */
type AiGeneratorDeps<TFallback> = {
  complete: CompleteFn;
  fallback: TFallback;
  /** Extra attempts after the first. Defaults to AI_RETRY_ATTEMPTS. */
  retries?: number;
};

/**
 * Runs `attempt` up to `1 + retries` times. Each failure (network or
 * parse/validate) triggers a retry; if every attempt fails, logs one concise
 * warning and resolves with `runFallback()`. This is the single source of the
 * retry/fallback policy so the two factories never duplicate it.
 */
const withRetryThenFallback = async <TResult>(
  label: string,
  retries: number,
  attempt: () => Promise<TResult>,
  runFallback: () => Promise<TResult>,
): Promise<TResult> => {
  const maxAttempts = 1 + retries;
  let lastError: unknown;

  for (let tries = 0; tries < maxAttempts; tries += 1) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }

  console.warn(
    `${label} failed after ${maxAttempts} attempt(s); using fallback.`,
    lastError,
  );
  return runFallback();
};

// ---------------------------------------------------------------------------
// Generator factories
// ---------------------------------------------------------------------------

/**
 * Builds a QuestionGenerator backed by the injected `complete` seam. On each
 * attempt: prompt → complete → parse → validate. Falls back to `fallback`
 * after exhausting retries.
 */
export const createAiQuestionGenerator = (
  deps: AiGeneratorDeps<QuestionGenerator>,
): QuestionGenerator => {
  const retries = deps.retries ?? AI_RETRY_ATTEMPTS;
  return {
    generateQuestions: (count) =>
      withRetryThenFallback(
        "ai question generation",
        retries,
        async () => {
          const text = await deps.complete(buildQuestionsPrompt(count));
          return validateQuestions(parseGeneratedList(text), count);
        },
        () => deps.fallback.generateQuestions(count),
      ),
  };
};

/**
 * Builds a DistractorGenerator backed by the injected `complete` seam. On each
 * attempt: prompt → complete → parse → dedupe. Falls back to `fallback` after
 * exhausting retries.
 */
export const createAiDistractorGenerator = (
  deps: AiGeneratorDeps<DistractorGenerator>,
): DistractorGenerator => {
  const retries = deps.retries ?? AI_RETRY_ATTEMPTS;
  return {
    generateDistractors: (question, realAnswer) =>
      withRetryThenFallback(
        "ai distractor generation",
        retries,
        async () => {
          const text = await deps.complete(
            buildDistractorsPrompt(question, realAnswer, DISTRACTOR_COUNT),
          );
          return dedupeDistractors(parseGeneratedList(text), realAnswer);
        },
        () => deps.fallback.generateDistractors(question, realAnswer),
      ),
  };
};

// ---------------------------------------------------------------------------
// Real Gemini SDK `complete` seam (lazily loaded, server-side only)
// ---------------------------------------------------------------------------

/** Response MIME type that forces the model to emit valid JSON. */
const JSON_RESPONSE_MIME_TYPE = "application/json";

/** A ready-to-use Gemini completion client: prompt in, raw text out. */
type GeminiClient = { generate: (prompt: string) => Promise<string> };

/**
 * Cached on globalThis (not a plain module variable) because Next.js gives
 * route handlers and server components SEPARATE module instances; a module-level
 * cache would be rebuilt per instance. Keyed by apiKey so a key change rebuilds.
 */
const globalGeminiStore = globalThis as unknown as {
  __klarmatesGeminiClient?: { apiKey: string; client: Promise<GeminiClient> };
};

/**
 * Returns a memoized Gemini client, importing the SDK and constructing
 * GoogleGenAI at most once per apiKey. Reused across every completion so a
 * single submit (which generates distractors for several answers at once) pays
 * the import + client-construction cost only once, not per call.
 */
const getGeminiClient = (apiKey: string): Promise<GeminiClient> => {
  const cached = globalGeminiStore.__klarmatesGeminiClient;
  if (cached && cached.apiKey === apiKey) {
    return cached.client;
  }

  const client: Promise<GeminiClient> = (async () => {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    return {
      generate: async (prompt) => {
        const response = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
          config: { responseMimeType: JSON_RESPONSE_MIME_TYPE },
        });
        return response.text ?? "";
      },
    };
  })();

  globalGeminiStore.__klarmatesGeminiClient = { apiKey, client };
  return client;
};

/**
 * Builds a real `CompleteFn` from a Gemini API key. The SDK is imported
 * DYNAMICALLY so it is never loaded unless a real key path runs (mirrors the
 * dynamic-import pattern in lib/auth.ts / lib/authz.ts). The key is read from
 * the caller and never returned or logged. `responseMimeType` guarantees valid
 * JSON; the prompt instructs the `{"questions":[...]}` / `{"distractors":[...]}`
 * shape that `parseGeneratedList` extracts.
 */
const createGeminiComplete = (apiKey: string): CompleteFn => {
  return async (prompt) => {
    const client = await getGeminiClient(apiKey);
    return client.generate(prompt);
  };
};

// ---------------------------------------------------------------------------
// Env-driven default generators
// ---------------------------------------------------------------------------

/** Reads a non-empty GEMINI_API_KEY from the environment, or undefined. */
const readApiKey = (): string | undefined => {
  const key = process.env.GEMINI_API_KEY;
  return key && key.length > 0 ? key : undefined;
};

/**
 * Question generator selected per call: with no API key it delegates directly
 * to the stub (byte-identical behaviour); with a key it runs the AI generator
 * (real `complete`) and falls back to the stub on failure.
 */
export const defaultQuestionGenerator: QuestionGenerator = {
  generateQuestions: (count) => {
    const apiKey = readApiKey();
    if (!apiKey) {
      return stubQuestionGenerator.generateQuestions(count);
    }
    const generator = createAiQuestionGenerator({
      complete: createGeminiComplete(apiKey),
      fallback: stubQuestionGenerator,
    });
    return generator.generateQuestions(count);
  },
};

/**
 * Distractor generator selected per call: with no API key it delegates directly
 * to the stub; with a key it runs the AI generator and falls back to the
 * stub on failure.
 */
export const defaultDistractorGenerator: DistractorGenerator = {
  generateDistractors: (question, realAnswer) => {
    const apiKey = readApiKey();
    if (!apiKey) {
      return stubDistractorGenerator.generateDistractors(question, realAnswer);
    }
    const generator = createAiDistractorGenerator({
      complete: createGeminiComplete(apiKey),
      fallback: stubDistractorGenerator,
    });
    return generator.generateDistractors(question, realAnswer);
  },
};
