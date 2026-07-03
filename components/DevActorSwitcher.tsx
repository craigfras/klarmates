"use client";

/**
 * Dev-only "act as player" control.
 *
 * Writes the chosen player id to the dev cookie and refreshes the route so the
 * server re-resolves the current player. Rendered only outside production (the
 * Nav gates it). This is dev tooling — it impersonates a fixture player so
 * multi-player flows are demoable before real auth exists.
 */

import { useRouter } from "next/navigation";
import { DEV_PLAYER_COOKIE } from "@/lib/devActor";
import type { Player } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type DevActorSwitcherProps = {
  players: Player[];
  currentPlayerId: string;
};

export function DevActorSwitcher({
  players,
  currentPlayerId,
}: DevActorSwitcherProps) {
  const router = useRouter();

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextId = event.target.value;
    document.cookie = `${DEV_PLAYER_COOKIE}=${nextId};path=/;max-age=${COOKIE_MAX_AGE_SECONDS};samesite=lax`;
    router.refresh();
  };

  return (
    <label className="dev-actor">
      <span className="dev-actor-label">Acting as</span>
      <select
        className="dev-actor-select mono"
        aria-label="Act as player"
        value={currentPlayerId}
        onChange={handleChange}
      >
        {players.map((player) => (
          <option key={player.id} value={player.id}>
            {player.name}
          </option>
        ))}
      </select>
    </label>
  );
}
