/**
 * RevealResult — present the outcome of a single guess.
 *
 * Pure presentation: a status region showing a ✓/✗ with an accessible label and
 * always the opponent's real answer text. Carries no game rules.
 */

import type { GuessResult } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CORRECT_MARK = "✓";
const INCORRECT_MARK = "✗";
const CORRECT_LABEL = "Correct!";
const INCORRECT_LABEL = "Not quite";
const REAL_ANSWER_PREFIX = "The real answer:";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type RevealResultProps = {
  result: GuessResult;
};

export function RevealResult({ result }: RevealResultProps) {
  const mark = result.correct ? CORRECT_MARK : INCORRECT_MARK;
  const label = result.correct ? CORRECT_LABEL : INCORRECT_LABEL;

  return (
    <p
      className="reveal-result"
      role="status"
      data-correct={result.correct ? "true" : "false"}
    >
      <span aria-hidden="true" className="reveal-mark">
        {mark}
      </span>{" "}
      <span className="reveal-label">{label}</span>{" "}
      <span className="reveal-answer">
        {REAL_ANSWER_PREFIX} {result.realAnswerText}
      </span>
    </p>
  );
}
