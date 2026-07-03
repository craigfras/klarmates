"use client";

/**
 * SuggestForm — the /suggest page's client form.
 *
 * Rendering and input-gathering only: a single question field and a submit
 * button. On submit it POSTs `{ text }` to the suggestions API; on success it
 * shows a confirmation with an "add another" reset (fire-and-forget: no list of
 * past suggestions). All rules live behind the API — this view has none.
 */

import { useState } from "react";
import { Button } from "@/components/Button";
import { DEFAULT_ERROR_MESSAGE } from "@/components/uiMessages";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUGGESTIONS_ENDPOINT = "/api/suggestions";
const FIELD_ID = "suggest-text";
const FIELD_LABEL = "Your question";
const SUBMIT_LABEL = "Suggest question";
const ADD_ANOTHER_LABEL = "Add another";
const THANKS_MESSAGE = "Thanks — your question is in the pool.";
const CONFIRM_SUBTEXT =
  "An admin decides when to use it. You won't see it again — that's by design.";
const INPUT_PLACEHOLDER = "What's a question worth asking a teammate?";
const FIELD_HINT = "One question at a time. Keep it something anyone could answer.";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SuggestForm() {
  // --- State: the draft text plus submission lifecycle ------------------
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(false);

  // --- Reset: clear the form so the player can add another --------------
  const handleAddAnother = () => {
    setText("");
    setSubmitted(false);
    setError(false);
  };

  // --- Submit: POST the text, then confirm or surface an error ----------
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(false);

    try {
      const response = await fetch(SUGGESTIONS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (response.ok) {
        setSubmitted(true);
      } else {
        setError(true);
      }
    } catch {
      // A network failure / rejected fetch is also a failure: surface it and
      // leave the form usable so the player can retry.
      setError(true);
    } finally {
      setSubmitting(false);
    }
  };

  // --- Confirmation: fire-and-forget, offer to add another --------------
  if (submitted) {
    return (
      <div className="suggest-confirmation">
        <span className="suggest-check" aria-hidden="true">
          ✓
        </span>
        <div className="suggest-confirmation-text">
          <p className="suggest-thanks">{THANKS_MESSAGE}</p>
          <p className="suggest-subtext">{CONFIRM_SUBTEXT}</p>
        </div>
        <Button type="button" onClick={handleAddAnother}>
          {ADD_ANOTHER_LABEL}
        </Button>
      </div>
    );
  }

  return (
    <form className="suggest-form" onSubmit={handleSubmit}>
      {/* --- Single question field --- */}
      <label className="suggest-field" htmlFor={FIELD_ID}>
        <span className="suggest-field-label">{FIELD_LABEL}</span>
        <textarea
          id={FIELD_ID}
          className="suggest-input"
          value={text}
          placeholder={INPUT_PLACEHOLDER}
          onChange={(event) => setText(event.target.value)}
          disabled={submitting}
          rows={3}
          autoFocus
        />
      </label>

      <p className="suggest-hint">{FIELD_HINT}</p>

      {/* --- Error surface --- */}
      {error && (
        <p className="suggest-error" role="alert">
          {DEFAULT_ERROR_MESSAGE}
        </p>
      )}

      {/* --- Single submit action --- */}
      <Button type="submit" loading={submitting} disabled={submitting}>
        {SUBMIT_LABEL}
      </Button>
    </form>
  );
}
