"use client";

/**
 * LeaderboardTable — the ranked standings with a season / all-time toggle.
 *
 * Rendering only: it holds the active scope in local state and renders the
 * pre-ranked rows it is handed. No fetching, no ranking — that is the service's
 * job. Two toggle buttons expose the active scope via `aria-pressed`, and the
 * table uses accessible semantics (column headers scoped to their column).
 */

import { useState } from "react";
import type { RankedRow } from "@/lib/scoring";
import type { LeaderboardScope } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEASON_SCOPE: LeaderboardScope = "season";
const ALL_TIME_SCOPE: LeaderboardScope = "all_time";

const SEASON_LABEL = "Season";
const ALL_TIME_LABEL = "All-time";

const RANK_HEADER = "Rank";
const PLAYER_HEADER = "Player";
const POINTS_HEADER = "Points";
const CORRECT_HEADER = "Correct";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type LeaderboardTableProps = {
  season: RankedRow[];
  allTime: RankedRow[];
};

export function LeaderboardTable({ season, allTime }: LeaderboardTableProps) {
  const [scope, setScope] = useState<LeaderboardScope>(SEASON_SCOPE);

  const rows = scope === SEASON_SCOPE ? season : allTime;

  return (
    <div className="leaderboard">
      {/* --- Scope toggle --- */}
      <div className="leaderboard-toggle" role="group">
        <button
          type="button"
          aria-pressed={scope === SEASON_SCOPE}
          onClick={() => setScope(SEASON_SCOPE)}
        >
          {SEASON_LABEL}
        </button>
        <button
          type="button"
          aria-pressed={scope === ALL_TIME_SCOPE}
          onClick={() => setScope(ALL_TIME_SCOPE)}
        >
          {ALL_TIME_LABEL}
        </button>
      </div>

      {/* --- Ranked standings --- */}
      <table className="leaderboard-table">
        <thead>
          <tr>
            <th scope="col">{RANK_HEADER}</th>
            <th scope="col">{PLAYER_HEADER}</th>
            <th scope="col">{POINTS_HEADER}</th>
            <th scope="col">{CORRECT_HEADER}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.playerId}>
              <td>{row.rank}</td>
              <td>{row.name}</td>
              <td>{row.total}</td>
              <td>{row.correctGuesses}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
