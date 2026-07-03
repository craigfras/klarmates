/**
 * Derives a single high-level status for a player's weekly matchup from a
 * MyWeekView. Services layer: pure TypeScript, no JSX/React.
 */

import type { MyWeekView } from "@/lib/types";

// ---------------------------------------------------------------------------
// Status kind
// ---------------------------------------------------------------------------

export type MatchupStatusKind =
  | "bye"
  | "answer_needed"
  | "waiting_opponent"
  | "guessing_unlocked"
  | "guessing_complete"
  | "recap";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Week status that means the matchup is over and only a recap remains. */
const CLOSED_STATUS: MyWeekView["status"] = "closed";

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Resolves the matchup status using a top-down precedence cascade:
 *   bye -> recap (closed) -> answer_needed -> waiting_opponent ->
 *   (guessing_complete | guessing_unlocked)
 */
export function getMatchupStatus(view: MyWeekView): MatchupStatusKind {
  if (view.isBye) {
    return "bye";
  }

  if (view.status === CLOSED_STATUS) {
    return "recap";
  }

  if (!view.myAnswersSubmitted) {
    return "answer_needed";
  }

  if (!view.opponentAnswered) {
    return "waiting_opponent";
  }

  return view.guessingComplete ? "guessing_complete" : "guessing_unlocked";
}
