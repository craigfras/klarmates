import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LeaderboardTable } from "@/components/LeaderboardTable";
import type { RankedRow } from "@/lib/scoring";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Season: Ada then Linus (tie on total 5, Ada wins the correctGuesses tiebreak).
const SEASON: RankedRow[] = [
  { playerId: "player-ada", name: "Ada Lovelace", total: 5, correctGuesses: 4, rank: 1 },
  { playerId: "player-linus", name: "Linus Bytes", total: 5, correctGuesses: 3, rank: 2 },
];

// All-time: Grace tops the board, a distinct ordering from the season board.
const ALL_TIME: RankedRow[] = [
  { playerId: "player-grace", name: "Grace Hopper", total: 20, correctGuesses: 16, rank: 1 },
  { playerId: "player-ada", name: "Ada Lovelace", total: 18, correctGuesses: 15, rank: 2 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const seasonButton = (): HTMLElement =>
  screen.getByRole("button", { name: /season/i });

const allTimeButton = (): HTMLElement =>
  screen.getByRole("button", { name: /all.?time/i });

const rowPlayerNames = (): string[] =>
  screen
    .getAllByRole("row")
    // Skip the header row (no rowheader/data cells we care about).
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[1]?.textContent ?? "");

// ---------------------------------------------------------------------------
// default render (season)
// ---------------------------------------------------------------------------

describe("LeaderboardTable: default season render", () => {
  it("renders the season rows with rank, name, points and correct columns", () => {
    render(<LeaderboardTable season={SEASON} allTime={ALL_TIME} />);

    // Column headers.
    expect(screen.getByRole("columnheader", { name: /rank/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /player/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /points/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /correct/i })).toBeInTheDocument();

    // Season players are shown by default.
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Linus Bytes")).toBeInTheDocument();
    // All-time-only player is not rendered yet.
    expect(screen.queryByText("Grace Hopper")).not.toBeInTheDocument();
  });

  it("orders the season rows by rank", () => {
    render(<LeaderboardTable season={SEASON} allTime={ALL_TIME} />);

    expect(rowPlayerNames()).toEqual(["Ada Lovelace", "Linus Bytes"]);
  });
});

// ---------------------------------------------------------------------------
// toggling to all-time
// ---------------------------------------------------------------------------

describe("LeaderboardTable: scope toggle", () => {
  it("switches to the all-time rows and ordering when the All-time toggle is clicked", async () => {
    const user = userEvent.setup();
    render(<LeaderboardTable season={SEASON} allTime={ALL_TIME} />);

    await user.click(allTimeButton());

    expect(rowPlayerNames()).toEqual(["Grace Hopper", "Ada Lovelace"]);
    expect(screen.queryByText("Linus Bytes")).not.toBeInTheDocument();
  });

  it("tracks the active scope via aria-pressed", async () => {
    const user = userEvent.setup();
    render(<LeaderboardTable season={SEASON} allTime={ALL_TIME} />);

    // Season is active by default.
    expect(seasonButton()).toHaveAttribute("aria-pressed", "true");
    expect(allTimeButton()).toHaveAttribute("aria-pressed", "false");

    await user.click(allTimeButton());

    expect(seasonButton()).toHaveAttribute("aria-pressed", "false");
    expect(allTimeButton()).toHaveAttribute("aria-pressed", "true");
  });
});
