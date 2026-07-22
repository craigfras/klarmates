import { describe, it, expect } from "vitest";
import {
  DISTRACTOR_COUNT,
  GEMINI_MODEL,
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

// ---------------------------------------------------------------------------
// GEMINI_MODEL: pins a model id valid on the developer API (regression)
// ---------------------------------------------------------------------------

// Gemini Flash models EMPIRICALLY confirmed reachable on the developer API
// (@google/genai + API key) for a current project, via scripts/probe-distractors
// (July 2026). Only add an id here after the probe returns real output for it —
// a wrong/unavailable id 404s and silently falls back to the canned stub, which
// is what shipped the duplicated, off-topic distractor options.
const VALID_DEVELOPER_API_GEMINI_MODELS = ["gemini-3.6-flash"] as const;

// Model ids confirmed NOT usable and kept out of the allowlist as guards:
//   - "gemini-3.5-flash": the original value at the time of the incident.
//   - "gemini-2.5-flash": 404s with "no longer available to new users" for a
//     freshly-provisioned project (confirmed via the probe).
const KNOWN_UNUSABLE_GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-2.5-flash",
] as const;

describe("ai: GEMINI_MODEL", () => {
  it("is a model id valid on the Gemini developer API", () => {
    expect(VALID_DEVELOPER_API_GEMINI_MODELS).toContain(GEMINI_MODEL);
  });

  it("is not one of the model ids confirmed unusable on the developer API", () => {
    expect(KNOWN_UNUSABLE_GEMINI_MODELS).not.toContain(GEMINI_MODEL);
  });
});
