/**
 * Admin matchups page.
 *
 * Server component: resolves the current dev actor and renders either an
 * access-denied notice (non-admin) or the AdminMatchupList component
 * pre-loaded with the current week's matchup overview.
 * Data fetching and privilege checking stay here; list UI is in the component.
 */

import { getDevActor } from "@/lib/use-cases/getDevActor";
import { gameService } from "@/lib/services";
import { AdminMatchupList } from "@/components/AdminMatchupList";
import { RestartWeekButton } from "@/components/RestartWeekButton";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Only an open week exposes the restart action. */
const OPEN_STATUS = "open";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AdminMatchupsPage() {
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

  const overview = await gameService.getAdminMatchups();
  const isOpen = overview.weekStatus === OPEN_STATUS;

  return (
    <main className="page">
      <div className="page-intro">
        <p className="page-kicker mono">Admin · Matchups</p>
        <h1 className="page-title">Matchups</h1>
        {/* --- Restart action: only for an open week --- */}
        {isOpen && <RestartWeekButton weekId={overview.weekId} />}
      </div>

      <AdminMatchupList overview={overview} />
    </main>
  );
}
