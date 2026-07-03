/**
 * Admin questions page.
 *
 * Server component: resolves the current dev actor and renders either an
 * access-denied notice (non-admin) or the AdminQuestionReview component
 * pre-loaded with the current draft questions for the upcoming week.
 * Data fetching and privilege checking stay here; review UI is in the component.
 */

import { getDevActor } from "@/lib/use-cases/getDevActor";
import { gameService } from "@/lib/services";
import { UPCOMING_WEEK_ID } from "@/lib/types";
import { AdminQuestionReview } from "@/components/AdminQuestionReview";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AdminQuestionsPage() {
  // --- Who am I? ---
  const { currentPlayer } = await getDevActor();

  // --- Render ---
  if (!currentPlayer.isAdmin) {
    return (
      <main className="page">
        <div className="page-intro">
          <p className="page-kicker mono">Access denied</p>
          <h1 className="page-title">Admins only</h1>
        </div>
        <p>You do not have permission to view this page.</p>
      </main>
    );
  }

  const questions = await gameService.getDraftQuestions(UPCOMING_WEEK_ID);
  // getDraftQuestions ensures the draft exists, so getDraftWeekInfo will find it.
  const draft = await gameService.getDraftWeekInfo();
  const suggestions = await gameService.listSuggestions();

  return (
    <main className="page">
      <div className="page-intro">
        <p className="page-kicker mono">Admin · Questions</p>
        <h1 className="page-title">Draft questions</h1>
      </div>

      <AdminQuestionReview
        weekId={UPCOMING_WEEK_ID}
        weekStartsAt={draft?.startsAt ?? ""}
        questions={questions}
        suggestions={suggestions}
      />
    </main>
  );
}
