/**
 * History — my past matchups and head-to-head recaps.
 *
 * Server component: resolves the current player and renders a `RecapCard` per
 * past entry. Data fetch and player resolution stay here; the cards are pure
 * rendering.
 */

import { getDevActor } from "@/lib/use-cases/getDevActor";
import { gameService } from "@/lib/services";
import { RecapCard } from "@/components/RecapCard";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMPTY_MESSAGE = "No past matchups yet — check back after a week wraps.";

export default async function HistoryPage() {
  // --- Who am I, and what have I played? ---
  const { currentPlayer } = await getDevActor();
  const entries = await gameService.getMyHistory(currentPlayer.id);

  // --- Render ---
  return (
    <main className="page">
      <div className="page-intro">
        <p className="page-kicker mono">Past weeks · {currentPlayer.name}</p>
        <h1 className="page-title">History</h1>
      </div>

      {entries.length === 0 ? (
        <p className="page-empty">{EMPTY_MESSAGE}</p>
      ) : (
        <ul className="history-list">
          {entries.map((entry) => (
            <li className="history-item" key={entry.weekId}>
              <RecapCard
                recap={entry.recap}
                opponentName={entry.opponentName}
                weekStartsAt={entry.startsAt}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
