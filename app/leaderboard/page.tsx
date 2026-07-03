/**
 * Leaderboard — season & all-time standings.
 *
 * Server component: fetches both ranked scopes once and hands them to the client
 * `LeaderboardTable`, which toggles between them locally. Ranking and tiebreaks
 * are the service's job; this page only fetches and lays out.
 */

import { gameService } from "@/lib/services";
import { LeaderboardTable } from "@/components/LeaderboardTable";

export default async function LeaderboardPage() {
  // --- Fetch both scopes up front so the toggle needs no round-trip ---
  const [season, allTime] = await Promise.all([
    gameService.getLeaderboard("season"),
    gameService.getLeaderboard("all_time"),
  ]);

  // --- Render ---
  return (
    <main className="page">
      <div className="page-intro">
        <p className="page-kicker mono">Standings</p>
        <h1 className="page-title">Leaderboard</h1>
      </div>

      <LeaderboardTable season={season} allTime={allTime} />
    </main>
  );
}
