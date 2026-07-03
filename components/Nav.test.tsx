import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Player } from "@/lib/types";
import type { DevActor } from "@/lib/use-cases/getDevActor";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/use-cases/getDevActor", () => ({ getDevActor: vi.fn() }));
// DevActorSwitcher uses useRouter; NavLink uses usePathname.
const pathnameMock = vi.fn<() => string>(() => "/");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => pathnameMock(),
}));

import { getDevActor } from "@/lib/use-cases/getDevActor";
import { Nav } from "@/components/Nav";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makePlayer = (id: string, name: string, isAdmin = false): Player => ({
  id,
  name,
  email: `${id}@getklar.com`,
  isAdmin,
  active: true,
});

const PLAYERS: Player[] = [
  makePlayer("player-ada", "Ada Lovelace"),
  makePlayer("player-linus", "Linus Bytes"),
];

const ADMIN_PLAYER = makePlayer("player-admin", "Admin User", true);

const DEV_ACTOR: DevActor = {
  players: PLAYERS,
  currentPlayerId: "player-ada",
  currentPlayer: PLAYERS[0],
};

// Dev actor whose currentPlayer has isAdmin === true.
const ADMIN_DEV_ACTOR: DevActor = {
  players: [...PLAYERS, ADMIN_PLAYER],
  currentPlayerId: "player-admin",
  currentPlayer: ADMIN_PLAYER,
};

// Dev actor whose currentPlayer has isAdmin === false (explicit).
const NON_ADMIN_DEV_ACTOR: DevActor = {
  players: PLAYERS,
  currentPlayerId: "player-ada",
  currentPlayer: PLAYERS[0], // isAdmin: false
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Nav", () => {
  beforeEach(() => {
    vi.mocked(getDevActor).mockReset();
    pathnameMock.mockReturnValue("/");
  });

  it("renders Home, Leaderboard and History links", async () => {
    vi.mocked(getDevActor).mockResolvedValue(DEV_ACTOR);

    render(await Nav());

    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Leaderboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "History" })).toBeInTheDocument();
  });

  it("marks only the active route's link as the current page (selector follows the tab)", async () => {
    vi.mocked(getDevActor).mockResolvedValue(DEV_ACTOR);
    pathnameMock.mockReturnValue("/leaderboard");

    render(await Nav());

    // The selector styling is driven by aria-current="page".
    expect(screen.getByRole("link", { name: "Leaderboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: "History" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("renders the dev switcher with an option per player when a dev actor resolves", async () => {
    vi.mocked(getDevActor).mockResolvedValue(DEV_ACTOR);

    render(await Nav());

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(PLAYERS.length);
    for (const player of PLAYERS) {
      expect(screen.getByRole("option", { name: player.name })).toBeInTheDocument();
    }
  });
});

// ---------------------------------------------------------------------------
// Admin link visibility
// ---------------------------------------------------------------------------

describe("Nav: Admin link", () => {
  it("renders an 'Admin' link to /admin when currentPlayer.isAdmin is true", async () => {
    vi.mocked(getDevActor).mockResolvedValue(ADMIN_DEV_ACTOR);

    render(await Nav());

    const adminLink = screen.getByRole("link", { name: "Admin" });
    expect(adminLink).toBeInTheDocument();
    expect(adminLink).toHaveAttribute("href", "/admin");
  });

  it("does NOT render an 'Admin' link when currentPlayer.isAdmin is false", async () => {
    vi.mocked(getDevActor).mockResolvedValue(NON_ADMIN_DEV_ACTOR);

    render(await Nav());

    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });
});
