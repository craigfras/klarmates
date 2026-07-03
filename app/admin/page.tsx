/**
 * Admin dashboard.
 *
 * Server component: resolves the current dev actor and renders either an
 * access-denied notice (non-admin) or the admin dashboard with links to the
 * main admin flows. Business logic and data fetching stay in their respective
 * layers; this page only composes and lays out.
 */

import Link from "next/link";
import { getDevActor } from "@/lib/use-cases/getDevActor";
import { AdminJobControls } from "@/components/AdminJobControls";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUESTIONS_HREF = "/admin/questions";
const ROSTER_HREF = "/admin/roster";
const MATCHUPS_HREF = "/admin/matchups";

const MANUAL_ACTIONS_KICKER = "Manual actions";
const MANUAL_ACTIONS_HEADING = "Run a job now";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AdminPage() {
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

  return (
    <main className="page">
      <div className="page-intro">
        <p className="page-kicker mono">Admin</p>
        <h1 className="page-title">Dashboard</h1>
      </div>

      <nav className="admin-nav">
        <Link href={QUESTIONS_HREF}>Questions</Link>
        <Link href={ROSTER_HREF}>Roster</Link>
        <Link href={MATCHUPS_HREF}>Matchups</Link>
      </nav>

      {/* --- Manual actions: on-demand triggers for the scheduled jobs --- */}
      <section className="admin-manual-actions">
        <p className="page-kicker mono">{MANUAL_ACTIONS_KICKER}</p>
        <h2 className="admin-section-heading">{MANUAL_ACTIONS_HEADING}</h2>
        <AdminJobControls />
      </section>
    </main>
  );
}
