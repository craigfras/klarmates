import { describe, it, expect } from "vitest";
import {
  DISTRACTOR_COUNT,
  stubDistractorGenerator,
  type DistractorGenerator,
} from "@/lib/ai";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const QUESTION = "What was the first programming language you ever learned?";
const REAL_ANSWER = "BASIC on a Commodore 64";

const OTHER_QUESTION = "Which code editor or IDE could you never give up?";
const OTHER_REAL_ANSWER = "Vim, obviously";

// A real answer that collides with a canned pool entry — exercises the filter
// that drops it and proves the pool stays large enough to still yield three.
const POOL_COLLISION_ANSWER = "C, the hard way";

// ---------------------------------------------------------------------------
// DISTRACTOR_COUNT constant
// ---------------------------------------------------------------------------

describe("ai: DISTRACTOR_COUNT", () => {
  it("is exactly 3", () => {
    expect(DISTRACTOR_COUNT).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// stubDistractorGenerator: shape + cardinality
// ---------------------------------------------------------------------------

describe("ai: stubDistractorGenerator conforms to DistractorGenerator", () => {
  it("exposes a generateDistractors method", () => {
    const generator: DistractorGenerator = stubDistractorGenerator;
    expect(typeof generator.generateDistractors).toBe("function");
  });

  it("resolves to an array of exactly DISTRACTOR_COUNT strings", async () => {
    const distractors = await stubDistractorGenerator.generateDistractors(
      QUESTION,
      REAL_ANSWER,
    );

    expect(Array.isArray(distractors)).toBe(true);
    expect(distractors).toHaveLength(DISTRACTOR_COUNT);
    for (const distractor of distractors) {
      expect(typeof distractor).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// stubDistractorGenerator: content rules
// ---------------------------------------------------------------------------

describe("ai: stubDistractorGenerator content rules", () => {
  it("returns only non-empty strings", async () => {
    const distractors = await stubDistractorGenerator.generateDistractors(
      QUESTION,
      REAL_ANSWER,
    );

    for (const distractor of distractors) {
      expect(distractor.trim().length).toBeGreaterThan(0);
    }
  });

  it("returns three distinct distractors", async () => {
    const distractors = await stubDistractorGenerator.generateDistractors(
      QUESTION,
      REAL_ANSWER,
    );

    expect(new Set(distractors).size).toBe(DISTRACTOR_COUNT);
  });

  it("never returns a distractor equal to the real answer", async () => {
    const distractors = await stubDistractorGenerator.generateDistractors(
      QUESTION,
      REAL_ANSWER,
    );

    expect(distractors).not.toContain(REAL_ANSWER);
  });

  it("still yields three distinct, non-colliding distractors when the real answer is one of the canned options", async () => {
    const distractors = await stubDistractorGenerator.generateDistractors(
      QUESTION,
      POOL_COLLISION_ANSWER,
    );

    expect(distractors).toHaveLength(DISTRACTOR_COUNT);
    expect(new Set(distractors).size).toBe(DISTRACTOR_COUNT);
    expect(distractors).not.toContain(POOL_COLLISION_ANSWER);
  });
});

// ---------------------------------------------------------------------------
// stubDistractorGenerator: determinism
// ---------------------------------------------------------------------------

describe("ai: stubDistractorGenerator determinism", () => {
  it("produces identical output for identical inputs", async () => {
    const first = await stubDistractorGenerator.generateDistractors(
      QUESTION,
      REAL_ANSWER,
    );
    const second = await stubDistractorGenerator.generateDistractors(
      QUESTION,
      REAL_ANSWER,
    );

    expect(first).toEqual(second);
  });

  it("does not share output between different inputs", async () => {
    const a = await stubDistractorGenerator.generateDistractors(
      QUESTION,
      REAL_ANSWER,
    );
    const b = await stubDistractorGenerator.generateDistractors(
      OTHER_QUESTION,
      OTHER_REAL_ANSWER,
    );

    // Differing inputs should not yield the identical array (would defeat the
    // purpose of seeding on the inputs). At least one element must differ.
    expect(a).not.toEqual(b);
  });
});
