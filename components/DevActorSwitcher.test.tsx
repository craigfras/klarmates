import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevActorSwitcher } from "@/components/DevActorSwitcher";
import { DEV_PLAYER_COOKIE } from "@/lib/devActor";
import type { Player } from "@/lib/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makePlayer = (id: string, name: string): Player => ({
  id,
  name,
  email: `${id}@getklar.com`,
  isAdmin: false,
  active: true,
});

const PLAYERS: Player[] = [
  makePlayer("player-ada", "Ada Lovelace"),
  makePlayer("player-linus", "Linus Bytes"),
  makePlayer("player-grace", "Grace Hopper"),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DevActorSwitcher", () => {
  beforeEach(() => {
    refresh.mockClear();
    // Clear any cookie set by a prior test.
    document.cookie = `${DEV_PLAYER_COOKIE}=;path=/;max-age=0`;
  });

  afterEach(() => {
    document.cookie = `${DEV_PLAYER_COOKIE}=;path=/;max-age=0`;
  });

  it("renders an option per player", () => {
    render(<DevActorSwitcher players={PLAYERS} currentPlayerId="player-ada" />);

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(PLAYERS.length);
    for (const player of PLAYERS) {
      expect(screen.getByRole("option", { name: player.name })).toBeInTheDocument();
    }
  });

  it("selects the current player id as the select value", () => {
    render(<DevActorSwitcher players={PLAYERS} currentPlayerId="player-linus" />);

    const select = screen.getByRole("combobox", { name: "Act as player" }) as HTMLSelectElement;
    expect(select.value).toBe("player-linus");
  });

  it("writes the cookie with the new id and calls router.refresh on change", () => {
    render(<DevActorSwitcher players={PLAYERS} currentPlayerId="player-ada" />);

    const select = screen.getByRole("combobox", { name: "Act as player" });
    fireEvent.change(select, { target: { value: "player-grace" } });

    expect(document.cookie).toContain(`${DEV_PLAYER_COOKIE}=player-grace`);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
