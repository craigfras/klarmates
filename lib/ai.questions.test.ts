/**
 * Tests for the QuestionGenerator seam in lib/ai.ts.
 *
 * CONTRACT:
 *   - `QuestionGenerator` interface: `{ generateQuestions(count: number): Promise<string[]> }`
 *   - `stubQuestionGenerator`: deterministic implementation of QuestionGenerator
 *   - `generateQuestions(count)`: convenience export that delegates to stubQuestionGenerator
 *
 * Mirrors the DistractorGenerator / stubDistractorGenerator / DISTRACTOR_COUNT
 * pattern already in lib/ai.ts.
 */

import { describe, it, expect } from "vitest";
import {
  WEEKLY_QUESTION_COUNT,
} from "@/lib/types";
import {
  stubQuestionGenerator,
  generateQuestions,
  type QuestionGenerator,
} from "@/lib/ai";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

/** A small count below the default for edge-case coverage. */
const SMALL_COUNT = 2;

/** A larger count to exercise the pool beyond the default. */
const LARGE_COUNT = 8;

// A sentinel prompt that must appear in the canned pool so tests can assert
// at least one stable, workplace-appropriate string. The code-writer must
// include a question whose text contains this substring.
const SENTINEL_SUBSTRING = "team";

// ---------------------------------------------------------------------------
// QuestionGenerator interface conformance
// ---------------------------------------------------------------------------

describe("ai: stubQuestionGenerator conforms to QuestionGenerator", () => {
  it("exposes a generateQuestions method", () => {
    const generator: QuestionGenerator = stubQuestionGenerator;
    expect(typeof generator.generateQuestions).toBe("function");
  });

  it("resolves to an array", async () => {
    const result = await stubQuestionGenerator.generateQuestions(WEEKLY_QUESTION_COUNT);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cardinality — returns exactly `count` prompts
// ---------------------------------------------------------------------------

describe("ai: stubQuestionGenerator cardinality", () => {
  it("returns exactly WEEKLY_QUESTION_COUNT (4) strings when asked for the default", async () => {
    const result = await stubQuestionGenerator.generateQuestions(WEEKLY_QUESTION_COUNT);
    expect(result).toHaveLength(WEEKLY_QUESTION_COUNT);
  });

  it("returns exactly SMALL_COUNT strings when count is below the default", async () => {
    const result = await stubQuestionGenerator.generateQuestions(SMALL_COUNT);
    expect(result).toHaveLength(SMALL_COUNT);
  });

  it("returns exactly LARGE_COUNT strings when count exceeds the default", async () => {
    const result = await stubQuestionGenerator.generateQuestions(LARGE_COUNT);
    expect(result).toHaveLength(LARGE_COUNT);
  });
});

// ---------------------------------------------------------------------------
// Content rules — all non-empty, all distinct
// ---------------------------------------------------------------------------

describe("ai: stubQuestionGenerator content rules", () => {
  it("returns only non-empty strings", async () => {
    const result = await stubQuestionGenerator.generateQuestions(WEEKLY_QUESTION_COUNT);
    for (const prompt of result) {
      expect(typeof prompt).toBe("string");
      expect(prompt.trim().length).toBeGreaterThan(0);
    }
  });

  it("returns all distinct prompts (no duplicates)", async () => {
    const result = await stubQuestionGenerator.generateQuestions(WEEKLY_QUESTION_COUNT);
    expect(new Set(result).size).toBe(WEEKLY_QUESTION_COUNT);
  });

  it("returns all distinct prompts for a larger count", async () => {
    const result = await stubQuestionGenerator.generateQuestions(LARGE_COUNT);
    expect(new Set(result).size).toBe(LARGE_COUNT);
  });

  it("contains at least one workplace-appropriate prompt (sentinel substring present)", async () => {
    const result = await stubQuestionGenerator.generateQuestions(LARGE_COUNT);
    const hasWorkplaceContent = result.some((prompt: string) =>
      prompt.toLowerCase().includes(SENTINEL_SUBSTRING),
    );
    expect(hasWorkplaceContent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("ai: stubQuestionGenerator determinism", () => {
  it("produces identical output across two calls with the same count", async () => {
    const first = await stubQuestionGenerator.generateQuestions(WEEKLY_QUESTION_COUNT);
    const second = await stubQuestionGenerator.generateQuestions(WEEKLY_QUESTION_COUNT);
    expect(first).toEqual(second);
  });

  it("produces identical output for LARGE_COUNT across repeated calls", async () => {
    const first = await stubQuestionGenerator.generateQuestions(LARGE_COUNT);
    const second = await stubQuestionGenerator.generateQuestions(LARGE_COUNT);
    expect(first).toEqual(second);
  });

  it("produces a different result for a different count (slice of the pool)", async () => {
    const four = await stubQuestionGenerator.generateQuestions(WEEKLY_QUESTION_COUNT);
    const two = await stubQuestionGenerator.generateQuestions(SMALL_COUNT);
    // The two-item slice must be a strict subset of (or at least differ in length from) four
    expect(two.length).not.toBe(four.length);
  });
});

// ---------------------------------------------------------------------------
// generateQuestions convenience export — delegates to stub
// ---------------------------------------------------------------------------

describe("ai: generateQuestions convenience export", () => {
  it("is a function", () => {
    expect(typeof generateQuestions).toBe("function");
  });

  it("resolves to the same result as stubQuestionGenerator.generateQuestions for WEEKLY_QUESTION_COUNT", async () => {
    const fromConvenience = await generateQuestions(WEEKLY_QUESTION_COUNT);
    const fromStub = await stubQuestionGenerator.generateQuestions(WEEKLY_QUESTION_COUNT);
    expect(fromConvenience).toEqual(fromStub);
  });

  it("returns exactly WEEKLY_QUESTION_COUNT items", async () => {
    const result = await generateQuestions(WEEKLY_QUESTION_COUNT);
    expect(result).toHaveLength(WEEKLY_QUESTION_COUNT);
  });
});
