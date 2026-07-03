import { describe, it, expect } from "vitest";
import {
  players,
  currentWeek,
  matchups,
  seedAnswers,
  seedAnswerOptions,
} from "@/lib/fixtures";
import type { StoredAnswer, StoredAnswerOption } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

const OPTIONS_PER_ANSWER = 4;
const CORRECT_OPTIONS_PER_ANSWER = 1;
// Three pre-answered players (ada, linus, grace) × four questions.
const SEEDED_PLAYER_IDS = ["player-ada", "player-linus", "player-grace"];
const EXPECTED_SEED_ANSWER_COUNT = SEEDED_PLAYER_IDS.length * 4;

// ---------------------------------------------------------------------------
// seedAnswers: referential integrity
// ---------------------------------------------------------------------------

describe("fixtures seed: seedAnswers references", () => {
  it("references only real players, questions and matchups", () => {
    const playerIds = new Set(players.map((p) => p.id));
    const questionIds = new Set(currentWeek.questions.map((q) => q.id));
    const matchupIds = new Set(matchups.map((m) => m.id));

    seedAnswers.forEach((answer: StoredAnswer) => {
      expect(playerIds.has(answer.playerId)).toBe(true);
      expect(questionIds.has(answer.questionId)).toBe(true);
      expect(matchupIds.has(answer.matchupId)).toBe(true);
      expect(answer.text.length).toBeGreaterThan(0);
    });
  });

  it("only seeds ada, linus and grace", () => {
    const seededPlayers = new Set(
      seedAnswers.map((a: StoredAnswer) => a.playerId),
    );
    expect([...seededPlayers].sort()).toEqual([...SEEDED_PLAYER_IDS].sort());
  });

  it("seeds exactly one answer per seeded player per question", () => {
    expect(seedAnswers).toHaveLength(EXPECTED_SEED_ANSWER_COUNT);
    const keys = seedAnswers.map(
      (a: StoredAnswer) => `${a.playerId}:${a.questionId}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has unique answer ids", () => {
    const ids = seedAnswers.map((a: StoredAnswer) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("matches the players already recorded in the matchups' answeredBy", () => {
    const answeredBy = new Set(matchups.flatMap((m) => m.answeredBy));
    const seededPlayers = new Set<string>(
      seedAnswers.map((a: StoredAnswer) => a.playerId),
    );
    // Every seeded player must be one the fixtures already mark as answered.
    seededPlayers.forEach((id: string) => {
      expect(answeredBy.has(id)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// seedAnswerOptions: shape per answer
// ---------------------------------------------------------------------------

describe("fixtures seed: seedAnswerOptions", () => {
  it("links every option back to a real seeded answer", () => {
    const answerIds = new Set(seedAnswers.map((a: StoredAnswer) => a.id));
    seedAnswerOptions.forEach((option: StoredAnswerOption) => {
      expect(answerIds.has(option.answerId)).toBe(true);
      expect(option.text.length).toBeGreaterThan(0);
    });
  });

  it("gives each seeded answer exactly four options with exactly one correct", () => {
    for (const answer of seedAnswers as StoredAnswer[]) {
      const options = seedAnswerOptions.filter(
        (option: StoredAnswerOption) => option.answerId === answer.id,
      );
      expect(options).toHaveLength(OPTIONS_PER_ANSWER);

      const correct = options.filter(
        (option: StoredAnswerOption) => option.isCorrect,
      );
      expect(correct).toHaveLength(CORRECT_OPTIONS_PER_ANSWER);
    }
  });

  it("uses the real answer text as the correct option for each seeded answer", () => {
    for (const answer of seedAnswers as StoredAnswer[]) {
      const correct = seedAnswerOptions.find(
        (option: StoredAnswerOption) =>
          option.answerId === answer.id && option.isCorrect,
      );
      expect(correct?.text).toBe(answer.text);
    }
  });

  it("has distractors that are distinct from the real answer", () => {
    for (const answer of seedAnswers as StoredAnswer[]) {
      const options = seedAnswerOptions.filter(
        (option: StoredAnswerOption) => option.answerId === answer.id,
      );
      const distractors = options.filter(
        (option: StoredAnswerOption) => !option.isCorrect,
      );
      distractors.forEach((distractor: StoredAnswerOption) => {
        expect(distractor.text).not.toBe(answer.text);
      });
    }
  });

  it("has unique option ids", () => {
    const ids = seedAnswerOptions.map((option: StoredAnswerOption) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
