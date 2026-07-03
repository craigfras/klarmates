/**
 * Tests for the pure prompt-builder functions in lib/aiPrompts.ts (slice 11).
 *
 * CONTRACT:
 *   - `buildQuestionsPrompt(count: number): string`
 *       Builds the prompt that asks the model for `count` icebreaker questions.
 *   - `buildDistractorsPrompt(question, realAnswer, count): string`
 *       Builds the prompt that asks the model for `count` plausible wrong
 *       answers that must not duplicate the real answer.
 *
 * These are pure string builders — no network, no side effects. Dynamic inputs
 * (count, question, realAnswer) are asserted STRICTLY (must be embedded
 * verbatim). Intent keywords are asserted LOOSELY (substring, case-insensitive)
 * so the code-writer keeps wording freedom.
 */

import { describe, it, expect } from "vitest";
import { WEEKLY_QUESTION_COUNT } from "@/lib/types";
import { buildQuestionsPrompt, buildDistractorsPrompt } from "@/lib/aiPrompts";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

const QUESTION = "What was the first programming language you ever learned?";
const REAL_ANSWER = "BASIC on a Commodore 64";
const DISTRACTOR_REQUEST_COUNT = 3;

/** Lower-cases once so keyword assertions stay case-insensitive and lenient. */
const lower = (value: string): string => value.toLowerCase();

/** True when at least one of the candidate substrings is present (case-insensitive). */
const includesAny = (haystack: string, candidates: string[]): boolean =>
  candidates.some((candidate) => lower(haystack).includes(lower(candidate)));

// ---------------------------------------------------------------------------
// buildQuestionsPrompt
// ---------------------------------------------------------------------------

describe("aiPrompts: buildQuestionsPrompt", () => {
  it("returns a non-empty string", () => {
    const prompt = buildQuestionsPrompt(WEEKLY_QUESTION_COUNT);
    expect(typeof prompt).toBe("string");
    expect(prompt.trim().length).toBeGreaterThan(0);
  });

  it("embeds the requested count verbatim", () => {
    const prompt = buildQuestionsPrompt(WEEKLY_QUESTION_COUNT);
    expect(prompt).toContain(String(WEEKLY_QUESTION_COUNT));
  });

  it("conveys the icebreaker/question intent", () => {
    const prompt = buildQuestionsPrompt(WEEKLY_QUESTION_COUNT);
    expect(includesAny(prompt, ["icebreaker", "question"])).toBe(true);
  });

  it("conveys the workplace-appropriate constraint", () => {
    const prompt = buildQuestionsPrompt(WEEKLY_QUESTION_COUNT);
    expect(includesAny(prompt, ["workplace", "appropriate"])).toBe(true);
  });

  it("conveys that questions must be distinct/different", () => {
    const prompt = buildQuestionsPrompt(WEEKLY_QUESTION_COUNT);
    expect(includesAny(prompt, ["distinct", "different"])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildDistractorsPrompt
// ---------------------------------------------------------------------------

describe("aiPrompts: buildDistractorsPrompt", () => {
  it("returns a non-empty string", () => {
    const prompt = buildDistractorsPrompt(
      QUESTION,
      REAL_ANSWER,
      DISTRACTOR_REQUEST_COUNT,
    );
    expect(typeof prompt).toBe("string");
    expect(prompt.trim().length).toBeGreaterThan(0);
  });

  it("embeds the literal question text", () => {
    const prompt = buildDistractorsPrompt(
      QUESTION,
      REAL_ANSWER,
      DISTRACTOR_REQUEST_COUNT,
    );
    expect(prompt).toContain(QUESTION);
  });

  it("embeds the literal real answer text", () => {
    const prompt = buildDistractorsPrompt(
      QUESTION,
      REAL_ANSWER,
      DISTRACTOR_REQUEST_COUNT,
    );
    expect(prompt).toContain(REAL_ANSWER);
  });

  it("embeds the requested count verbatim", () => {
    const prompt = buildDistractorsPrompt(
      QUESTION,
      REAL_ANSWER,
      DISTRACTOR_REQUEST_COUNT,
    );
    expect(prompt).toContain(String(DISTRACTOR_REQUEST_COUNT));
  });

  it("conveys the plausible-but-wrong intent", () => {
    const prompt = buildDistractorsPrompt(
      QUESTION,
      REAL_ANSWER,
      DISTRACTOR_REQUEST_COUNT,
    );
    expect(includesAny(prompt, ["plausible", "wrong"])).toBe(true);
  });

  it("conveys that distractors must not duplicate the real answer", () => {
    const prompt = buildDistractorsPrompt(
      QUESTION,
      REAL_ANSWER,
      DISTRACTOR_REQUEST_COUNT,
    );
    const forbidsDuplication =
      includesAny(prompt, ["never"]) ||
      (includesAny(prompt, ["not"]) &&
        includesAny(prompt, ["duplicate", "same", "equal"]));
    expect(forbidsDuplication).toBe(true);
  });
});
