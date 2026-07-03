/**
 * Suggest — propose an icebreaker question for an upcoming week.
 *
 * Server component: renders a short intro and the client `SuggestForm`. Open to
 * any active player. Fire-and-forget — no list of the player's past suggestions.
 * Rendering only; the write path lives behind the suggestions API.
 */

import { SuggestForm } from "@/components/SuggestForm";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_KICKER = "Suggestion box";
const PAGE_TITLE = "Suggest a question";
const PAGE_INTRO =
  "Drop an icebreaker into the pool. An admin may pick it up for an upcoming week — no need to check back.";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SuggestPage() {
  // --- Render intro + form ---
  return (
    <main className="suggest">
      <div className="suggest-intro">
        <p className="suggest-kicker mono">{PAGE_KICKER}</p>
        <h1 className="suggest-title">{PAGE_TITLE}</h1>
        <p className="suggest-lede">{PAGE_INTRO}</p>
      </div>

      <SuggestForm />
    </main>
  );
}
