/**
 * Guess — guess your opponent's answers.
 *
 * Server component: resolves the current player, derives their week, and gates
 * on whether guessing is unlocked. When unlocked it loads the guess sheet and
 * hands rendering to the client `GuessForm`; otherwise it shows a gentle nudge.
 */

import Link from "next/link";
import { getDevActor } from "@/lib/use-cases/getDevActor";
import { gameService } from "@/lib/services";
import { GuessForm } from "@/components/GuessForm";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCKED_MESSAGE = "Guessing isn't unlocked yet.";
const HOME_HREF = "/";
const HOME_LABEL = "Back to this week";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function GuessPage() {
  // --- Who am I, and is guessing open for me? ---
  const { currentPlayer } = await getDevActor();
  const view = await gameService.getMyWeek(currentPlayer.id);

  // --- Locked: nudge back home rather than throwing ---
  if (!view.guessingUnlocked) {
    return (
      <main className="guess">
        <p className="guess-locked">{LOCKED_MESSAGE}</p>
        <Link href={HOME_HREF}>{HOME_LABEL}</Link>
      </main>
    );
  }

  // --- Unlocked: load the sheet and render the form ---
  const sheet = await gameService.getGuessSheet(
    currentPlayer.id,
    view.weekId,
  );
  const opponentName = view.opponent?.name ?? "your opponent";

  return (
    <main className="guess">
      <div className="page-intro">
        <p className="page-kicker mono">Guessing</p>
        <h1 className="page-title">Guess {opponentName}&apos;s answers</h1>
      </div>

      <GuessForm sheet={sheet} weekId={view.weekId} />
    </main>
  );
}
