"use client";

/**
 * GuessForm — guess the opponent's answers, one question at a time.
 *
 * Rendering and input-gathering only: each question is an independent radio
 * group with its own Guess button. Submitting one question POSTs the chosen
 * option, then reveals the result inline and locks that question — leaving the
 * others editable. All game rules live behind the API; this view carries none.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RevealResult } from "@/components/RevealResult";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { useOptionalToast } from "@/components/Toast";
import { DEFAULT_ERROR_MESSAGE } from "@/components/uiMessages";
import type { GuessResult, GuessSheet } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GUESSES_ENDPOINT = "/api/me/guesses";
const SUBMIT_LABEL = "Guess";
const SUCCESS_TOAST = "Guess submitted";

const HOME_ROUTE = "/";

// --- Completion-modal copy -------------------------------------------------
// CRITICAL: inside the dialog, digits live ONLY in `.score-figure`, and exactly
// one element matches /score|correct|of/i (the `.score-caption`). The title,
// note, and OK label must contain no digit and none of "score"/"correct"/"of".
const SCORE_TITLE = "Week complete!";
const SCORE_OK_LABEL = "OK";
const SCORE_CAPTION = "correct guesses";
const SCORE_FIGURE_JOINER = "/";

// Friendly, celebratory line keyed to the player's tally. None of these contain
// a digit or the substrings "score" / "correct" / "of".
const NOTE_PERFECT = "Perfect week!";
const NOTE_SOME = "Nice guessing!";
const NOTE_NONE = "Tough week — better luck next time.";

const buildScoreNote = (correct: number, total: number): string => {
  if (total > 0 && correct >= total) {
    return NOTE_PERFECT;
  }
  if (correct > 0) {
    return NOTE_SOME;
  }
  return NOTE_NONE;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type GuessFormProps = {
  sheet: GuessSheet;
  weekId: string;
};

export function GuessForm({ sheet, weekId }: GuessFormProps) {
  const router = useRouter();
  const toast = useOptionalToast();

  // --- Per-question state, keyed by questionId --------------------------
  // Results are seeded from any sheet items that already carry a prior result,
  // so already-guessed questions render locked + revealed on mount.
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, GuessResult>>(() =>
    Object.fromEntries(
      sheet.filter((item) => item.result).map((item) => [item.questionId, item.result!]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  // --- Completion modal: opens only on an in-session final guess --------
  const [showScore, setShowScore] = useState(false);

  const handleSelect = (questionId: string, optionId: string) => {
    setSelected((previous) => ({ ...previous, [questionId]: optionId }));
  };

  // --- Submit one question: POST, then reveal+lock or surface an error --
  const handleGuess = async (questionId: string) => {
    const chosenOptionId = selected[questionId];
    if (!chosenOptionId) {
      return;
    }
    setErrors((previous) => ({ ...previous, [questionId]: false }));
    setPending((previous) => ({ ...previous, [questionId]: true }));

    try {
      const response = await fetch(GUESSES_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekId, questionId, chosenOptionId }),
      });

      if (response.ok) {
        const result = (await response.json()) as GuessResult;
        const nextResults = { ...results, [questionId]: result };
        setResults(nextResults);
        toast.success(SUCCESS_TOAST);
        router.refresh();
        // Open the score modal once this guess completes the whole sheet.
        const allComplete = sheet.every((item) => nextResults[item.questionId]);
        if (allComplete) {
          setShowScore(true);
        }
      } else {
        setErrors((previous) => ({ ...previous, [questionId]: true }));
        toast.error(DEFAULT_ERROR_MESSAGE);
      }
    } finally {
      setPending((previous) => ({ ...previous, [questionId]: false }));
    }
  };

  // --- Week score derived from the resolved results --------------------
  const correctCount = Object.values(results).filter((result) => result.correct).length;
  const totalQuestions = sheet.length;

  return (
    <form className="guess-form" onSubmit={(event) => event.preventDefault()}>
      {/* --- Completion score modal; OK returns home --- */}
      <Modal
        open={showScore}
        title={SCORE_TITLE}
        okLabel={SCORE_OK_LABEL}
        onOk={() => router.push(HOME_ROUTE)}
      >
        <div className="score-dialog">
          <p className="score-figure">
            {correctCount} {SCORE_FIGURE_JOINER} {totalQuestions}
          </p>
          <p className="score-caption">{SCORE_CAPTION}</p>
          <p className="score-note">
            {buildScoreNote(correctCount, totalQuestions)}
          </p>
        </div>
      </Modal>

      {/* --- One independent radio group + action per question --- */}
      {sheet.map((item) => {
        const locked = results[item.questionId] !== undefined;
        const hasSelection = selected[item.questionId] !== undefined;
        const labelId = `${item.questionId}-label`;

        return (
          <div
            className="guess-question"
            key={item.questionId}
            role="group"
            aria-labelledby={labelId}
            data-locked={locked || undefined}
          >
            <p className="guess-question-text" id={labelId}>
              {item.questionText}
            </p>

            {item.options.map((option) => (
              <label className="guess-option" key={option.id}>
                <input
                  type="radio"
                  name={item.questionId}
                  value={option.id}
                  checked={selected[item.questionId] === option.id}
                  disabled={locked}
                  onChange={() => handleSelect(item.questionId, option.id)}
                />
                <span>{option.text}</span>
              </label>
            ))}

            {/* --- Error surface (question stays editable) --- */}
            {errors[item.questionId] && (
              <p className="guess-error" role="alert">
                {DEFAULT_ERROR_MESSAGE}
              </p>
            )}

            {/* --- Inline reveal once submitted --- */}
            {locked && <RevealResult result={results[item.questionId]} />}

            {/* --- Per-question submit --- */}
            <Button
              type="button"
              loading={pending[item.questionId]}
              disabled={locked || !hasSelection}
              onClick={() => handleGuess(item.questionId)}
            >
              {SUBMIT_LABEL}
            </Button>
          </div>
        );
      })}
    </form>
  );
}
