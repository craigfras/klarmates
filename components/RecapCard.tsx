/**
 * RecapCard — present a single head-to-head recap.
 *
 * Pure presentation: shows "You X/Q" against "<opponent> Y/Q" for a closed
 * week. Carries no game rules.
 */

import { formatWeekDate } from "@/lib/formatWeekDate";
import type { Recap } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MINE_LABEL = "You";
const VERSUS = "vs";
const WEEK_LABEL_PREFIX = "Week of";

/** Builds the "Week of <date>" label naming the recap's week. */
const weekLabel = (formattedDate: string) => `${WEEK_LABEL_PREFIX} ${formattedDate}`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type RecapCardProps = {
  recap: Recap;
  opponentName: string;
  /** ISO start date of the recap's week; drives the "Week of" heading. */
  weekStartsAt: string;
};

export function RecapCard({ recap, opponentName, weekStartsAt }: RecapCardProps) {
  const weekDate = formatWeekDate(weekStartsAt);

  return (
    <div className="recap">
      {/* --- Week heading: names the week this recap is for --- */}
      {weekDate && <p className="recap-week mono">{weekLabel(weekDate)}</p>}

      {/* --- My tally --- */}
      <span className="recap-tally recap-score-mine">
        {MINE_LABEL} {recap.meCorrect}/{recap.questionCount}
      </span>

      <span className="recap-vs">{VERSUS}</span>

      {/* --- Opponent tally --- */}
      <span className="recap-tally">
        {opponentName} {recap.opponentCorrect}/{recap.questionCount}
      </span>
    </div>
  );
}
