"use client";

/**
 * AdminQuestionReview — review, edit and approve the week's draft questions.
 *
 * Rendering and input-gathering only: one editable text field per question
 * with per-question Save and Regenerate actions, a single "Approve & open week"
 * action, and a suggestion pool where each pending suggestion can be Used into a
 * chosen draft slot or Discarded. On success it refreshes the route. On failure
 * it surfaces an error via role="alert". All game rules live behind the API —
 * this view carries none.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { useOptionalToast } from "@/components/Toast";
import { DEFAULT_ERROR_MESSAGE } from "@/components/uiMessages";
import { formatWeekDate } from "@/lib/formatWeekDate";
import type { Question, QuestionSuggestion } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUESTIONS_ENDPOINT = "/api/admin/week/questions";
const APPROVE_ENDPOINT = "/api/admin/week/approve";
const SUGGESTIONS_ENDPOINT = "/api/admin/suggestions";

const SAVE_LABEL = "Save";
const REGENERATE_LABEL = "Regenerate";
const APPROVE_LABEL = "Approve & open week";
const USE_LABEL = "Use";
const DISCARD_LABEL = "Discard";

const ACTION_EDIT = "edit";
const ACTION_REGENERATE = "regenerate";
const ACTION_USE = "use";
const ACTION_REMOVE = "remove";

const SAVE_SUCCESS_TOAST = "Question saved";
const REGENERATE_SUCCESS_TOAST = "Question regenerated";
const APPROVE_SUCCESS_TOAST = "Week approved & opened";
const USE_SUCCESS_TOAST = "Suggestion used";
const DISCARD_SUCCESS_TOAST = "Suggestion discarded";

// Pending-key prefixes identifying the single in-flight action.
const KEY_SAVE = "save";
const KEY_REGENERATE = "regen";
const KEY_APPROVE = "approve";
const KEY_USE = "use";
const KEY_DISCARD = "discard";

const keyFor = (prefix: string, questionId: string) => `${prefix}:${questionId}`;

/** Builds the "week of" label naming the week the questions are for. */
const weekLabel = (formattedDate: string) =>
  `Questions for the week of ${formattedDate}`;

// --- Suggestions panel copy (display-only in this slice) -----------------
const SUGGESTIONS_HEADING = "Suggestion pool";
const SUGGESTIONS_EMPTY =
  "No suggestions yet. Players add them from the suggestion box.";

/** Builds the "suggested by <name>" attribution line for one suggestion. */
const suggestedByLabel = (name: string) => `Suggested by ${name}`;

/** Builds a slot option label: "Slot 1 — <current question text>". */
const slotOptionLabel = (index: number, text: string) =>
  `Slot ${index + 1} — ${text}`;

/**
 * Accessible label for one suggestion's slot picker. Includes the suggestion
 * text so each select is distinguishable to assistive tech (there is one per
 * pending suggestion).
 */
const slotSelectLabel = (suggestionText: string) =>
  `Target slot for suggestion: ${suggestionText}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AdminQuestionReviewProps = {
  weekId: string;
  /** ISO start date of the week being drafted; drives the "week of" label. */
  weekStartsAt: string;
  questions: Question[];
  /** Standing suggestion pool, pre-sorted newest-first by the service. */
  suggestions: QuestionSuggestion[];
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminQuestionReview({
  weekId,
  weekStartsAt,
  questions,
  suggestions,
}: AdminQuestionReviewProps) {
  const router = useRouter();
  const toast = useOptionalToast();

  // --- Week label: names the week these questions are for ------------------
  const weekDate = formatWeekDate(weekStartsAt);

  // --- State: controlled text per question, error + in-flight key ---------
  const [texts, setTexts] = useState<Record<string, string>>(
    Object.fromEntries(questions.map((q) => [q.id, q.text])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  // --- State: the draft slot each suggestion targets (defaults to slot 1) --
  // Which slot a suggestion overwrites is transient UI state, not a game rule.
  const firstQuestionId = questions[0]?.id ?? "";
  const [selectedSlots, setSelectedSlots] = useState<Record<string, string>>(
    Object.fromEntries(suggestions.map((s) => [s.id, firstQuestionId])),
  );

  const handleTextChange = (questionId: string, value: string) => {
    setTexts((previous) => ({ ...previous, [questionId]: value }));
  };

  const handleSlotChange = (suggestionId: string, value: string) => {
    setSelectedSlots((previous) => ({ ...previous, [suggestionId]: value }));
  };

  // --- Shared POST helper: track in-flight key, POST, handle ok/error ----
  const postAndRefresh = async (
    key: string,
    endpoint: string,
    body: Record<string, unknown>,
    successMessage: string,
  ): Promise<void> => {
    setError(null);
    setPendingKey(key);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const data = (await response.json()) as { questions?: Question[] };
        if (data.questions) {
          const updated = Object.fromEntries(data.questions.map((q) => [q.id, q.text]));
          setTexts(updated);
        }
        toast.success(successMessage);
        router.refresh();
      } else {
        const data = (await response.json()) as { error?: string };
        const message = data.error ?? DEFAULT_ERROR_MESSAGE;
        setError(message);
        toast.error(message);
      }
    } finally {
      setPendingKey(null);
    }
  };

  // --- Per-question handlers --------------------------------------------
  const handleSave = (questionId: string) => {
    void postAndRefresh(
      keyFor(KEY_SAVE, questionId),
      QUESTIONS_ENDPOINT,
      { action: ACTION_EDIT, questionId, text: texts[questionId] },
      SAVE_SUCCESS_TOAST,
    );
  };

  const handleRegenerate = (questionId: string) => {
    void postAndRefresh(
      keyFor(KEY_REGENERATE, questionId),
      QUESTIONS_ENDPOINT,
      { action: ACTION_REGENERATE, questionId },
      REGENERATE_SUCCESS_TOAST,
    );
  };

  // --- Per-suggestion handlers ------------------------------------------
  const handleUse = (suggestionId: string) => {
    const draftQuestionId = selectedSlots[suggestionId] ?? firstQuestionId;
    void postAndRefresh(
      keyFor(KEY_USE, suggestionId),
      SUGGESTIONS_ENDPOINT,
      { action: ACTION_USE, suggestionId, draftQuestionId },
      USE_SUCCESS_TOAST,
    );
  };

  const handleDiscard = (suggestionId: string) => {
    void postAndRefresh(
      keyFor(KEY_DISCARD, suggestionId),
      SUGGESTIONS_ENDPOINT,
      { action: ACTION_REMOVE, suggestionId },
      DISCARD_SUCCESS_TOAST,
    );
  };

  // --- Approve handler --------------------------------------------------
  const handleApprove = () => {
    void postAndRefresh(KEY_APPROVE, APPROVE_ENDPOINT, { weekId }, APPROVE_SUCCESS_TOAST);
  };

  return (
    <div className="admin-question-review">
      {/* --- Week label: names the week these questions are for --- */}
      {weekDate && (
        <p className="admin-question-review-week page-kicker mono">
          {weekLabel(weekDate)}
        </p>
      )}

      {/* --- Error surface --- */}
      {error && (
        <p className="admin-question-review-error" role="alert">
          {error}
        </p>
      )}

      {/* --- One editable field + actions per question --- */}
      {questions.map((question) => (
        <div className="admin-question-row" key={question.id}>
          <input
            type="text"
            value={texts[question.id] ?? question.text}
            onChange={(event) => handleTextChange(question.id, event.target.value)}
            aria-label={question.text}
          />
          <Button
            type="button"
            loading={pendingKey === keyFor(KEY_SAVE, question.id)}
            onClick={() => handleSave(question.id)}
          >
            {SAVE_LABEL}
          </Button>
          <Button
            type="button"
            loading={pendingKey === keyFor(KEY_REGENERATE, question.id)}
            onClick={() => handleRegenerate(question.id)}
          >
            {REGENERATE_LABEL}
          </Button>
        </div>
      ))}

      {/* --- Suggestions panel: pool rendered in the order given by the
             service (newest-first). Each row picks a target draft slot and
             Uses the suggestion into it, or Discards it. Sits between the draft
             slots and the approve action. Plain div (not a <section>/region
             landmark) so it never collides with the toast live region. --- */}
      <div className="admin-suggestions">
        <div className="admin-suggestions-head">
          <h2 className="admin-suggestions-heading">{SUGGESTIONS_HEADING}</h2>
          {suggestions.length > 0 && (
            <span className="admin-suggestions-count mono">
              {suggestions.length}
            </span>
          )}
        </div>
        {suggestions.length === 0 ? (
          <p className="admin-suggestions-empty">{SUGGESTIONS_EMPTY}</p>
        ) : (
          <ul className="admin-suggestions-list">
            {suggestions.map((suggestion) => (
              <li className="admin-suggestion-row" key={suggestion.id}>
                <p className="admin-suggestion-text">{suggestion.text}</p>
                <p className="admin-suggestion-author mono">
                  {suggestedByLabel(suggestion.suggestedByName)}
                </p>

                {/* --- Use / Discard controls: pick a slot then Use to
                       overwrite it, or Discard to drop the suggestion. --- */}
                <div className="admin-suggestion-controls">
                  <select
                    className="admin-suggestion-slot"
                    aria-label={slotSelectLabel(suggestion.text)}
                    value={selectedSlots[suggestion.id] ?? firstQuestionId}
                    onChange={(event) =>
                      handleSlotChange(suggestion.id, event.target.value)
                    }
                  >
                    {questions.map((question, index) => (
                      <option value={question.id} key={question.id}>
                        {slotOptionLabel(index, texts[question.id] ?? question.text)}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    className="admin-suggestion-use"
                    loading={pendingKey === keyFor(KEY_USE, suggestion.id)}
                    onClick={() => handleUse(suggestion.id)}
                  >
                    {USE_LABEL}
                  </Button>
                  <Button
                    type="button"
                    className="admin-suggestion-discard"
                    loading={pendingKey === keyFor(KEY_DISCARD, suggestion.id)}
                    onClick={() => handleDiscard(suggestion.id)}
                  >
                    {DISCARD_LABEL}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* --- Single approve action --- */}
      <Button type="button" loading={pendingKey === KEY_APPROVE} onClick={handleApprove}>
        {APPROVE_LABEL}
      </Button>
    </div>
  );
}
