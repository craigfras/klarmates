/**
 * Tests for the AI-backed generators, their pure parse/validate/dedupe
 * helpers, and the env-driven default generators in lib/ai.ts (slice 11).
 *
 * CONTRACT (intended new exports from "@/lib/ai"):
 *   Pure helpers:
 *     - parseGeneratedList(raw: string): string[]
 *     - validateQuestions(items: string[], count: number): string[]   (throws on invalid)
 *     - dedupeDistractors(items: string[], realAnswer: string): string[]   (throws on too few)
 *   Generator factories (injectable `complete` seam + stub fallback):
 *     - createAiQuestionGenerator(deps): QuestionGenerator
 *     - createAiDistractorGenerator(deps): DistractorGenerator
 *   Env-driven defaults (no GEMINI_API_KEY → behave like stubs):
 *     - defaultQuestionGenerator: QuestionGenerator
 *     - defaultDistractorGenerator: DistractorGenerator
 *
 * `CompleteFn = (prompt: string) => Promise<string>` returns the model's raw
 * JSON text. Tests pass fakes — never hit the network. The real Gemini SDK
 * call is HITL-verified and intentionally not unit-tested here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WEEKLY_QUESTION_COUNT } from "@/lib/types";
import {
  DISTRACTOR_COUNT,
  stubQuestionGenerator,
  stubDistractorGenerator,
  parseGeneratedList,
  validateQuestions,
  dedupeDistractors,
  createAiQuestionGenerator,
  createAiDistractorGenerator,
  defaultQuestionGenerator,
  defaultDistractorGenerator,
  type QuestionGenerator,
  type DistractorGenerator,
} from "@/lib/ai";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

const QUESTION = "What was the first programming language you ever learned?";
const REAL_ANSWER = "Vim";

/** Call-count expectations for the retry behaviour. */
const SINGLE_CALL = 1;
const RETRY_SUCCESS_CALLS = 2;

/** Distinct sentinel arrays so fallback usage is unambiguous in assertions. */
const FALLBACK_QUESTIONS: string[] = Array.from(
  { length: WEEKLY_QUESTION_COUNT },
  (_unused, index) => `FALLBACK_QUESTION_${index}`,
);
const FALLBACK_DISTRACTORS: string[] = Array.from(
  { length: DISTRACTOR_COUNT },
  (_unused, index) => `FALLBACK_DISTRACTOR_${index}`,
);

/** Valid model outputs for the happy paths, sized to the requested counts. */
const VALID_QUESTIONS: string[] = Array.from(
  { length: WEEKLY_QUESTION_COUNT },
  (_unused, index) => `Generated question ${index}?`,
);
const VALID_DISTRACTORS: string[] = ["Emacs", "VS Code", "Nano"];

// ---------------------------------------------------------------------------
// Controllable stub fallbacks (return known sentinels so we can detect use)
// ---------------------------------------------------------------------------

const makeFallbackQuestionGenerator = (): {
  generator: QuestionGenerator;
  calls: { count: number };
} => {
  const calls = { count: 0 };
  const generator: QuestionGenerator = {
    generateQuestions: async () => {
      calls.count += 1;
      return [...FALLBACK_QUESTIONS];
    },
  };
  return { generator, calls };
};

const makeFallbackDistractorGenerator = (): {
  generator: DistractorGenerator;
  calls: { count: number };
} => {
  const calls = { count: 0 };
  const generator: DistractorGenerator = {
    generateDistractors: async () => {
      calls.count += 1;
      return [...FALLBACK_DISTRACTORS];
    },
  };
  return { generator, calls };
};

// ---------------------------------------------------------------------------
// parseGeneratedList — tolerant parser
// ---------------------------------------------------------------------------

describe("ai: parseGeneratedList", () => {
  it("parses a JSON array of strings", () => {
    expect(parseGeneratedList('["a","b","c"]')).toEqual(["a", "b", "c"]);
  });

  it("parses a JSON object whose first array-valued property holds the strings (questions)", () => {
    expect(parseGeneratedList('{"questions":["a","b"]}')).toEqual(["a", "b"]);
  });

  it("parses a JSON object whose first array-valued property holds the strings (distractors)", () => {
    expect(parseGeneratedList('{"distractors":["x","y","z"]}')).toEqual([
      "x",
      "y",
      "z",
    ]);
  });

  it("falls back to newline-delimited parsing when the input is not JSON", () => {
    expect(parseGeneratedList("a\nb\nc")).toEqual(["a", "b", "c"]);
  });

  it("strips leading list markers, numbering, and quotes in the newline fallback", () => {
    expect(parseGeneratedList("1. a\n- b\n* c")).toEqual(["a", "b", "c"]);
  });

  it("trims whitespace and drops empty lines in the newline fallback", () => {
    expect(parseGeneratedList("  a  \n\n   \n b \n")).toEqual(["a", "b"]);
  });

  // -------------------------------------------------------------------------
  // Regression: truncated / malformed JSON must THROW, never newline-split
  //
  // Gemini can hit the output-token limit mid-object, returning JSON that
  // starts with `{`/`[` but never closes. The old parser caught the parse
  // error and shredded the raw text by "\n", turning fragments like `{`,
  // `"distractors": [`, and `"...fridge",` into answer options that were then
  // stored in the DB. A broken JSON-shaped response must throw so the caller's
  // retry-then-fallback path runs instead.
  // -------------------------------------------------------------------------

  it("throws on a truncated JSON object and does NOT emit its raw lines as options", () => {
    const truncated =
      '{\n' +
      '  "distractors": [\n' +
      '    "I prefer eating almost all of my meals completely cold straight from the fridge",';

    expect(() => parseGeneratedList(truncated)).toThrow();

    // The exact reported bug: raw JSON scaffolding leaked in as options.
    let leaked: string[] | undefined;
    try {
      leaked = parseGeneratedList(truncated);
    } catch {
      leaked = undefined;
    }
    expect(leaked).toBeUndefined();
    expect(leaked ?? []).not.toContain("{");
    expect(leaked ?? []).not.toContain('"distractors": [');
  });

  it("throws on a truncated JSON array", () => {
    expect(() => parseGeneratedList('[\n  "a",\n  "b",')).toThrow();
  });

  it("throws on a malformed-but-JSON-shaped object", () => {
    expect(() => parseGeneratedList("{ not valid json")).toThrow();
  });

  // -------------------------------------------------------------------------
  // Markdown code fences must be stripped before parsing
  // -------------------------------------------------------------------------

  it("strips ```json fences around a JSON array before parsing", () => {
    expect(parseGeneratedList('```json\n["a","b"]\n```')).toEqual(["a", "b"]);
  });

  it("strips plain ``` fences around a JSON array before parsing", () => {
    expect(parseGeneratedList('```\n["a","b"]\n```')).toEqual(["a", "b"]);
  });

  it("strips ```json fences around a JSON object with a distractors key", () => {
    expect(
      parseGeneratedList('```json\n{"distractors":["x","y","z"]}\n```'),
    ).toEqual(["x", "y", "z"]);
  });
});

// ---------------------------------------------------------------------------
// validateQuestions — exact-count, non-empty, distinct, else throws
// ---------------------------------------------------------------------------

describe("ai: validateQuestions", () => {
  it("returns the trimmed list when it has exactly `count` distinct non-empty items", () => {
    const items = ["  one  ", "two", "three"];
    expect(validateQuestions(items, 3)).toEqual(["one", "two", "three"]);
  });

  it("throws when there are too few items", () => {
    expect(() => validateQuestions(["one", "two"], 3)).toThrow();
  });

  it("throws when there are too many items", () => {
    expect(() =>
      validateQuestions(["one", "two", "three", "four"], 3),
    ).toThrow();
  });

  it("throws when an item is empty or whitespace-only", () => {
    expect(() => validateQuestions(["one", "   ", "three"], 3)).toThrow();
  });

  it("throws when items contain a duplicate", () => {
    expect(() => validateQuestions(["one", "one", "three"], 3)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// dedupeDistractors — strips real answer + dups, must yield DISTRACTOR_COUNT
// ---------------------------------------------------------------------------

describe("ai: dedupeDistractors", () => {
  it("returns DISTRACTOR_COUNT distractors when given that many clean, distinct ones", () => {
    const result = dedupeDistractors(["Emacs", "VS Code", "Nano"], REAL_ANSWER);
    expect(result).toHaveLength(DISTRACTOR_COUNT);
    expect(new Set(result.map((value) => value.toLowerCase())).size).toBe(
      DISTRACTOR_COUNT,
    );
  });

  it("removes a case-insensitive match to the real answer and returns the others", () => {
    // realAnswer "Vim"; item "vim" must be dropped, leaving exactly 3 others.
    const result = dedupeDistractors(
      ["Emacs", "vim", "VS Code", "Nano"],
      REAL_ANSWER,
    );
    expect(result).toHaveLength(DISTRACTOR_COUNT);
    expect(result.map((value) => value.toLowerCase())).not.toContain("vim");
  });

  it("throws when collapsing case-insensitive duplicates leaves fewer than DISTRACTOR_COUNT", () => {
    expect(() =>
      dedupeDistractors(["Emacs", "emacs", "Nano"], REAL_ANSWER),
    ).toThrow();
  });

  it("throws when fewer than DISTRACTOR_COUNT usable distractors remain", () => {
    expect(() => dedupeDistractors(["Emacs", "Nano"], REAL_ANSWER)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// createAiQuestionGenerator — fallback-guarded AI question generation
// ---------------------------------------------------------------------------

describe("ai: createAiQuestionGenerator", () => {
  it("returns the parsed/validated model output on the happy path (fallback unused)", async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify(VALID_QUESTIONS));
    const { generator: fallback, calls } = makeFallbackQuestionGenerator();

    const gen = createAiQuestionGenerator({ complete, fallback });
    const result = await gen.generateQuestions(WEEKLY_QUESTION_COUNT);

    expect(result).toEqual(VALID_QUESTIONS);
    expect(complete).toHaveBeenCalledTimes(SINGLE_CALL);
    expect(calls.count).toBe(0);
  });

  it("retries once and succeeds when the first complete call rejects (fallback unused)", async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(JSON.stringify(VALID_QUESTIONS));
    const { generator: fallback, calls } = makeFallbackQuestionGenerator();

    const gen = createAiQuestionGenerator({ complete, fallback });
    const result = await gen.generateQuestions(WEEKLY_QUESTION_COUNT);

    expect(result).toEqual(VALID_QUESTIONS);
    expect(complete).toHaveBeenCalledTimes(RETRY_SUCCESS_CALLS);
    expect(calls.count).toBe(0);
  });

  it("falls back when complete always rejects", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("down"));
    const { generator: fallback, calls } = makeFallbackQuestionGenerator();

    const gen = createAiQuestionGenerator({ complete, fallback });
    const result = await gen.generateQuestions(WEEKLY_QUESTION_COUNT);

    expect(result).toEqual(FALLBACK_QUESTIONS);
    expect(calls.count).toBe(SINGLE_CALL);
  });

  it("falls back when the model output is malformed / the wrong count on every attempt", async () => {
    const complete = vi.fn().mockResolvedValue('["only-one"]');
    const { generator: fallback, calls } = makeFallbackQuestionGenerator();

    const gen = createAiQuestionGenerator({ complete, fallback });
    const result = await gen.generateQuestions(WEEKLY_QUESTION_COUNT);

    expect(result).toEqual(FALLBACK_QUESTIONS);
    expect(calls.count).toBe(SINGLE_CALL);
  });
});

// ---------------------------------------------------------------------------
// createAiDistractorGenerator — fallback-guarded AI distractors
// ---------------------------------------------------------------------------

describe("ai: createAiDistractorGenerator", () => {
  it("returns DISTRACTOR_COUNT deduped distractors on the happy path (fallback unused)", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue(JSON.stringify(VALID_DISTRACTORS));
    const { generator: fallback, calls } = makeFallbackDistractorGenerator();

    const gen = createAiDistractorGenerator({ complete, fallback });
    const result = await gen.generateDistractors(QUESTION, REAL_ANSWER);

    expect(result).toHaveLength(DISTRACTOR_COUNT);
    expect(result).toEqual(VALID_DISTRACTORS);
    expect(complete).toHaveBeenCalledTimes(SINGLE_CALL);
    expect(calls.count).toBe(0);
  });

  it("retries once and succeeds when the first complete call rejects (fallback unused)", async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(JSON.stringify(VALID_DISTRACTORS));
    const { generator: fallback, calls } = makeFallbackDistractorGenerator();

    const gen = createAiDistractorGenerator({ complete, fallback });
    const result = await gen.generateDistractors(QUESTION, REAL_ANSWER);

    expect(result).toEqual(VALID_DISTRACTORS);
    expect(complete).toHaveBeenCalledTimes(RETRY_SUCCESS_CALLS);
    expect(calls.count).toBe(0);
  });

  it("falls back when complete always rejects", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("down"));
    const { generator: fallback, calls } = makeFallbackDistractorGenerator();

    const gen = createAiDistractorGenerator({ complete, fallback });
    const result = await gen.generateDistractors(QUESTION, REAL_ANSWER);

    expect(result).toEqual(FALLBACK_DISTRACTORS);
    expect(calls.count).toBe(SINGLE_CALL);
  });

  it("falls back when the output cannot yield DISTRACTOR_COUNT valid distractors", async () => {
    // Every item equals the real answer (case-insensitively) → none usable.
    const allRealAnswer = JSON.stringify(["vim", "VIM", "Vim"]);
    const complete = vi.fn().mockResolvedValue(allRealAnswer);
    const { generator: fallback, calls } = makeFallbackDistractorGenerator();

    const gen = createAiDistractorGenerator({ complete, fallback });
    const result = await gen.generateDistractors(QUESTION, REAL_ANSWER);

    expect(result).toEqual(FALLBACK_DISTRACTORS);
    expect(calls.count).toBe(SINGLE_CALL);
  });

  // -------------------------------------------------------------------------
  // Regression: truncated JSON on every attempt must fall back to the stub,
  // never surface raw JSON scaffolding (`{`, `"distractors": [`) as options.
  // -------------------------------------------------------------------------

  it("falls back on truncated JSON and never yields raw JSON scaffolding as distractors", async () => {
    const truncated = '{\n  "distractors": [\n    "a",';
    const complete = vi.fn().mockResolvedValue(truncated);
    const { generator: fallback, calls } = makeFallbackDistractorGenerator();

    const gen = createAiDistractorGenerator({ complete, fallback });
    const result = await gen.generateDistractors(QUESTION, REAL_ANSWER);

    expect(result).toEqual(FALLBACK_DISTRACTORS);
    expect(calls.count).toBe(SINGLE_CALL);
    expect(result).not.toContain("{");
    expect(result).not.toContain('"distractors": [');
  });
});

// ---------------------------------------------------------------------------
// Default generators — no API key present → must behave like the stubs
// ---------------------------------------------------------------------------

describe("ai: default generators with no GEMINI_API_KEY", () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    if (savedKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = savedKey;
    }
  });

  it("defaultQuestionGenerator matches stubQuestionGenerator output", async () => {
    const fromDefault =
      await defaultQuestionGenerator.generateQuestions(WEEKLY_QUESTION_COUNT);
    const fromStub =
      await stubQuestionGenerator.generateQuestions(WEEKLY_QUESTION_COUNT);
    expect(fromDefault).toEqual(fromStub);
  });

  it("defaultDistractorGenerator matches stubDistractorGenerator output", async () => {
    const fromDefault = await defaultDistractorGenerator.generateDistractors(
      QUESTION,
      REAL_ANSWER,
    );
    const fromStub = await stubDistractorGenerator.generateDistractors(
      QUESTION,
      REAL_ANSWER,
    );
    expect(fromDefault).toEqual(fromStub);
  });
});
