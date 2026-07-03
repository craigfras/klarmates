"use client";

/**
 * AnswerForm — collect and submit the player's weekly answers.
 *
 * Rendering and input-gathering only: one labeled text field per question and a
 * single submit button. On submit it POSTs the answers to the API and, on
 * success, refreshes the route and locks the form. All game rules live behind
 * the API — this view carries none.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { useOptionalToast } from "@/components/Toast";
import { DEFAULT_ERROR_MESSAGE } from "@/components/uiMessages";
import type { AnswerSubmission, MyWeekView } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANSWERS_ENDPOINT = "/api/me/answers";
const SUBMIT_LABEL = "Submit answers";
const SUCCESS_TOAST = "Answers submitted";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type AnswerFormProps = {
  view: MyWeekView;
};

export function AnswerForm({ view }: AnswerFormProps) {
  const router = useRouter();
  const toast = useOptionalToast();

  // --- State: one answer per question, plus submission lifecycle --------
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(false);

  const handleChange = (questionId: string, value: string) => {
    setTexts((previous) => ({ ...previous, [questionId]: value }));
  };

  // --- Submit: gather inputs, POST, then refresh or surface an error ----
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(false);

    const answers: AnswerSubmission[] = view.questions.map((question) => ({
      questionId: question.id,
      text: texts[question.id] ?? "",
    }));

    try {
      const response = await fetch(ANSWERS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekId: view.weekId, answers }),
      });

      if (response.ok) {
        setSubmitted(true);
        toast.success(SUCCESS_TOAST);
        router.refresh();
      } else {
        setError(true);
        toast.error(DEFAULT_ERROR_MESSAGE);
      }
    } catch {
      // A network failure / rejected fetch is also a failure: surface it and
      // leave the form usable so the player can retry.
      setError(true);
      toast.error(DEFAULT_ERROR_MESSAGE);
    } finally {
      // On success `submitted` keeps the form locked; on error this re-enables it.
      setSubmitting(false);
    }
  };

  const disabled = submitting || submitted;

  return (
    <form className="answer-form" onSubmit={handleSubmit}>
      {/* --- One labeled field per question --- */}
      {view.questions.map((question) => (
        <label className="answer-field" key={question.id} htmlFor={question.id}>
          <span className="answer-field-label">{question.text}</span>
          <input
            id={question.id}
            type="text"
            value={texts[question.id] ?? ""}
            onChange={(event) => handleChange(question.id, event.target.value)}
            disabled={disabled}
          />
        </label>
      ))}

      {/* --- Error surface --- */}
      {error && (
        <p className="answer-error" role="alert">
          {DEFAULT_ERROR_MESSAGE}
        </p>
      )}

      {/* --- Single submit action --- */}
      <Button type="submit" loading={submitting} disabled={disabled}>
        {SUBMIT_LABEL}
      </Button>
    </form>
  );
}
