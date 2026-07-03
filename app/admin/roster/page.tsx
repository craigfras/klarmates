/**
 * Admin roster page.
 *
 * Server component: resolves the current dev actor and renders either an
 * access-denied notice (non-admin) or the RosterManager component pre-loaded
 * with the full player roster and the current week's absence data.
 * Data fetching and privilege checking stay here; roster UI is in the component.
 */

import { getDevActor } from "@/lib/use-cases/getDevActor";
import { gameService } from "@/lib/services";
import { UPCOMING_WEEK_ID } from "@/lib/types";
import { RosterManager } from "@/components/RosterManager";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AdminRosterPage() {
  // --- Who am I? ---
  const { currentPlayer } = await getDevActor();

  // --- Render: access-denied for non-admins ---
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

  // --- Fetch roster and compute absent ids --------------------------------
  const players = await gameService.listRoster();
  const present = await gameService.getPresentPlayers(UPCOMING_WEEK_ID);

  const absentPlayerIds = players
    .filter((p) => p.active && !present.some((q) => q.id === p.id))
    .map((p) => p.id);

  return (
    <main className="page">
      <div className="page-intro">
        <p className="page-kicker mono">Admin · Roster</p>
        <h1 className="page-title">Roster</h1>
      </div>

      <RosterManager
        players={players}
        absentPlayerIds={absentPlayerIds}
        weekId={UPCOMING_WEEK_ID}
      />
    </main>
  );
}
