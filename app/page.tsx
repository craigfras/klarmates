/**
 * Home — "This Week".
 *
 * Server component: resolves the current player (dev cookie for now), asks the
 * game service for their view of the week, and renders the fixture. Data fetch
 * and player resolution stay here; the card is pure rendering.
 */

import Link from "next/link";
import { getDevActor } from "@/lib/use-cases/getDevActor";
import { gameService } from "@/lib/services";
import { getMatchupStatus } from "@/lib/services/matchupStatus";
import { MatchupCard } from "@/components/MatchupCard";
import { AnswerForm } from "@/components/AnswerForm";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GUESS_HREF = "/guess";
const SUGGEST_HREF = "/suggest";

export default async function Home() {
  // --- Who am I acting as, and what's my week? ---
  const { currentPlayer } = await getDevActor();
  const view = await gameService.getMyWeek(currentPlayer.id);
  const status = getMatchupStatus(view);
  const needsAnswers = status === "answer_needed";
  const canGuess = status === "guessing_unlocked";
  const opponentName = view.opponent?.name ?? "your opponent";

  // --- Render ---
  return (
    <main className="home">
      <div className="home-intro">
        <p className="home-kicker mono">This week · {currentPlayer.name}</p>
        <h1 className="home-title">Your matchup</h1>
      </div>

      <MatchupCard view={view} me={currentPlayer} />

      {/* When the player still owes answers, the form is the call to action. */}
      {needsAnswers && <AnswerForm view={view} />}

      {/* Once both have answered, the call to action is the guess flow. */}
      {canGuess && (
        <Link className="home-cta" href={GUESS_HREF}>
          Guess {opponentName}&apos;s answers →
        </Link>
      )}

      {/* Always-available: propose an icebreaker for an upcoming week. */}
      <Link className="home-link" href={SUGGEST_HREF}>
        Suggest a question →
      </Link>
    </main>
  );
}
