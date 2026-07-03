/**
 * AdminMatchupList — admin overview of the current week's matchups.
 *
 * Presentational only: no client-side state, no fetching. Receives an
 * AdminWeekOverview and renders matchup rows with participant answered
 * indicators, plus a byes region.
 */

import type { AdminMatchupRow, AdminMatchupStatus, AdminWeekOverview } from "@/lib/types";
import { formatWeekDate } from "@/lib/formatWeekDate";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Human-readable label for each matchup status value. */
const STATUS_LABEL: Record<AdminMatchupStatus, string> = {
  awaiting_both: "Awaiting both",
  awaiting_one: "Awaiting one",
  guessing_unlocked: "Guessing unlocked",
};

const EMPTY_MATCHUPS_TEXT = "No matchups this week.";
const NO_BYES_TEXT = "No byes this week.";
const ANSWERED_TEXT = "Answered";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Renders one participant group with an optional "Answered" indicator. */
type ParticipantGroupProps = {
  name: string;
  answered: boolean;
};

function ParticipantGroup({ name, answered }: ParticipantGroupProps) {
  return (
    <div role="group" aria-label={name} className="admin-matchup-participant">
      <span className="admin-matchup-player-name">{name}</span>
      {answered && (
        <span className="admin-matchup-answered">{ANSWERED_TEXT}</span>
      )}
    </div>
  );
}

/** Renders a single matchup row as a list item. */
type MatchupRowProps = {
  row: AdminMatchupRow;
};

function MatchupRow({ row }: MatchupRowProps) {
  const ariaLabel = `matchup: ${row.playerA.name} vs ${row.playerB.name}`;

  return (
    <li role="listitem" aria-label={ariaLabel} className="admin-matchup-row">
      {/* --- Status badge (data-status drives the per-status styling) --- */}
      <span className="admin-matchup-status" data-status={row.status}>
        {STATUS_LABEL[row.status]}
      </span>

      {/* --- Participants --- */}
      <div className="admin-matchup-players">
        <ParticipantGroup
          name={row.playerA.name}
          answered={row.playerA.answered}
        />
        <ParticipantGroup
          name={row.playerB.name}
          answered={row.playerB.answered}
        />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type AdminMatchupListProps = {
  overview: AdminWeekOverview;
};

export function AdminMatchupList({ overview }: AdminMatchupListProps) {
  const { weekStatus, matchups, byePlayers } = overview;
  const weekDate = formatWeekDate(overview.startsAt);

  return (
    <div className="admin-matchup-list">
      {/* --- Week caption: the week's formatted start date and lifecycle status --- */}
      <p className="admin-matchup-weekstatus mono">
        {weekDate ? `${weekDate} · ${weekStatus}` : weekStatus}
      </p>

      {/* --- Matchup rows --- */}
      <ul className="admin-matchup-ul">
        {matchups.length === 0 ? (
          <li className="admin-matchup-empty">{EMPTY_MATCHUPS_TEXT}</li>
        ) : (
          matchups.map((row) => <MatchupRow key={row.matchupId} row={row} />)
        )}
      </ul>

      {/* --- Byes region --- */}
      <section
        role="region"
        aria-label="Byes"
        className="admin-matchup-byes"
      >
        <h2 className="admin-matchup-byes-heading">Byes</h2>
        {byePlayers.length === 0 ? (
          <p className="admin-matchup-byes-empty">{NO_BYES_TEXT}</p>
        ) : (
          <ul className="admin-matchup-byes-list">
            {byePlayers.map((player) => (
              <li key={player.id} className="admin-matchup-byes-item">
                {player.name}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
