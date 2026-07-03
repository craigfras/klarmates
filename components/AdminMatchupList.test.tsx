/**
 * Tests for AdminMatchupList (presentational component, no "use client", no fetch).
 *
 * CONTRACT DECISIONS (for code-writer):
 *
 *   Props: { overview: AdminWeekOverview }
 *
 *   DOM structure:
 *     - A <section> or <ul> containing one item per matchup, each wrapped in
 *       an element with aria-label="matchup: <playerA.name> vs <playerB.name>"
 *       (e.g. role="listitem" or role="article"). This accessible name lets
 *       tests scope queries within the right row via within().
 *
 *     - Within each matchup row:
 *         - Both player names rendered as visible text.
 *         - A human-readable status string:
 *             "awaiting_both"     → "Awaiting both"
 *             "awaiting_one"      → "Awaiting one"
 *             "guessing_unlocked" → "Guessing unlocked"
 *         - An "answered" indicator for each participant who has answered.
 *           Exact indicator text: "Answered" (plain text span/badge).
 *           When answered===false the indicator must NOT appear within that
 *           participant's sub-section.
 *           Each participant sub-section should carry an accessible name of
 *           "<playerName>" so within() can scope to it.
 *
 *     - A byes section (role="region", accessible name matching /byes/i):
 *         - Lists each bye player's name.
 *         - When byePlayers is empty, renders the text "No byes this week."
 *           inside the byes region (and no player names).
 *
 *     - When matchups is an empty array, renders the text
 *       "No matchups this week." (and no matchup rows).
 *
 *   Status copy mapping (code-writer must use EXACTLY these strings):
 *     awaiting_both     → "Awaiting both"
 *     awaiting_one      → "Awaiting one"
 *     guessing_unlocked → "Guessing unlocked"
 *
 *   Answered indicator copy: "Answered"
 *   Empty matchups copy:     "No matchups this week."
 *   Empty byes copy:         "No byes this week."
 */

import { render, screen, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AdminMatchupList } from "@/components/AdminMatchupList";
import type { AdminWeekOverview, AdminMatchupRow } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

const EMPTY_MATCHUPS_TEXT = "No matchups this week.";
const NO_BYES_TEXT = "No byes this week.";
const ANSWERED_INDICATOR = "Answered";

// The week caption shows the week's START DATE (formatted), never the raw id.
const WEEK_STARTS_AT = "2026-06-22T00:00:00.000Z";
const FORMATTED_WEEK_DATE = "Jun 22, 2026";
const RECOGNIZABLE_WEEK_ID = "week-2026-25";
const OPEN_STATUS_COPY = "open";

const STATUS_COPY: Record<AdminMatchupRow["status"], string> = {
  awaiting_both: "Awaiting both",
  awaiting_one: "Awaiting one",
  guessing_unlocked: "Guessing unlocked",
};

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const makeRow = (overrides: Partial<AdminMatchupRow> = {}): AdminMatchupRow => ({
  matchupId: "m1",
  playerA: { id: "p1", name: "Ada Lovelace", answered: false },
  playerB: { id: "p2", name: "Linus Bytes", answered: false },
  status: "awaiting_both",
  ...overrides,
});

const makeOverview = (
  overrides: Partial<AdminWeekOverview> = {},
): AdminWeekOverview => ({
  weekId: "week-1",
  startsAt: WEEK_STARTS_AT,
  weekStatus: "open",
  matchups: [],
  byePlayers: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getMatchupRow = (playerAName: string, playerBName: string): HTMLElement =>
  screen.getByRole("listitem", {
    name: new RegExp(`matchup.*${playerAName}.*vs.*${playerBName}`, "i"),
  });

const getByesRegion = (): HTMLElement =>
  screen.getByRole("region", { name: /byes/i });

// ---------------------------------------------------------------------------
// Week caption — formatted date, not the raw week id
// ---------------------------------------------------------------------------

describe("AdminMatchupList: week caption", () => {
  it("renders the week's formatted START DATE, not the raw week id", () => {
    render(
      <AdminMatchupList
        overview={makeOverview({
          weekId: RECOGNIZABLE_WEEK_ID,
          startsAt: WEEK_STARTS_AT,
          weekStatus: "open",
        })}
      />,
    );

    // The caption shows the formatted date.
    expect(screen.getByText(new RegExp(FORMATTED_WEEK_DATE))).toBeInTheDocument();
    // The raw week id must NOT be rendered anywhere.
    expect(screen.queryByText(new RegExp(RECOGNIZABLE_WEEK_ID))).toBeNull();
    // The lifecycle status still appears alongside the date.
    expect(screen.getByText(new RegExp(OPEN_STATUS_COPY))).toBeInTheDocument();
  });

  it("degrades to just the status (no stray separator) when the week has no start date", () => {
    render(
      <AdminMatchupList
        overview={makeOverview({
          weekId: RECOGNIZABLE_WEEK_ID,
          startsAt: "",
          weekStatus: "open",
        })}
      />,
    );

    // Status still shows; no date, no raw id, and no dangling "·" separator.
    expect(screen.getByText(new RegExp(OPEN_STATUS_COPY))).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(FORMATTED_WEEK_DATE))).toBeNull();
    expect(screen.queryByText(new RegExp(RECOGNIZABLE_WEEK_ID))).toBeNull();
    expect(screen.queryByText(/·/)).toBeNull();
    expect(screen.queryByText(/invalid date/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Empty matchups
// ---------------------------------------------------------------------------

describe("AdminMatchupList: empty matchups", () => {
  it("renders the empty-state message when matchups is an empty array", () => {
    render(<AdminMatchupList overview={makeOverview({ matchups: [] })} />);

    expect(screen.getByText(EMPTY_MATCHUPS_TEXT)).toBeInTheDocument();
  });

  it("does not render any matchup rows when matchups is empty", () => {
    render(<AdminMatchupList overview={makeOverview({ matchups: [] })} />);

    // No listitem with the "matchup:" accessible name pattern should exist.
    const rows = screen.queryAllByRole("listitem", { name: /matchup/i });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Matchup rows — player names
// ---------------------------------------------------------------------------

describe("AdminMatchupList: player names", () => {
  it("renders both player names within the matchup row", () => {
    const row = makeRow({
      playerA: { id: "p1", name: "Ada Lovelace", answered: false },
      playerB: { id: "p2", name: "Linus Bytes", answered: false },
    });
    render(<AdminMatchupList overview={makeOverview({ matchups: [row] })} />);

    const matchupRow = getMatchupRow("Ada Lovelace", "Linus Bytes");
    expect(within(matchupRow).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(matchupRow).getByText("Linus Bytes")).toBeInTheDocument();
  });

  it("renders a separate row per matchup", () => {
    const rows = [
      makeRow({
        matchupId: "m1",
        playerA: { id: "p1", name: "Ada Lovelace", answered: false },
        playerB: { id: "p2", name: "Linus Bytes", answered: false },
      }),
      makeRow({
        matchupId: "m2",
        playerA: { id: "p3", name: "Grace Hopper", answered: true },
        playerB: { id: "p4", name: "Dennis Ritchie", answered: true },
        status: "guessing_unlocked",
      }),
    ];
    render(<AdminMatchupList overview={makeOverview({ matchups: rows })} />);

    expect(getMatchupRow("Ada Lovelace", "Linus Bytes")).toBeInTheDocument();
    expect(getMatchupRow("Grace Hopper", "Dennis Ritchie")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Matchup rows — status copy
// ---------------------------------------------------------------------------

describe("AdminMatchupList: status copy", () => {
  it("renders 'Awaiting both' for awaiting_both status", () => {
    const row = makeRow({ status: "awaiting_both" });
    render(<AdminMatchupList overview={makeOverview({ matchups: [row] })} />);

    const matchupRow = getMatchupRow("Ada Lovelace", "Linus Bytes");
    expect(within(matchupRow).getByText(STATUS_COPY.awaiting_both)).toBeInTheDocument();
  });

  it("renders 'Awaiting one' for awaiting_one status", () => {
    const row = makeRow({
      status: "awaiting_one",
      playerA: { id: "p1", name: "Ada Lovelace", answered: true },
      playerB: { id: "p2", name: "Linus Bytes", answered: false },
    });
    render(<AdminMatchupList overview={makeOverview({ matchups: [row] })} />);

    const matchupRow = getMatchupRow("Ada Lovelace", "Linus Bytes");
    expect(within(matchupRow).getByText(STATUS_COPY.awaiting_one)).toBeInTheDocument();
  });

  it("renders 'Guessing unlocked' for guessing_unlocked status", () => {
    const row = makeRow({
      status: "guessing_unlocked",
      playerA: { id: "p1", name: "Ada Lovelace", answered: true },
      playerB: { id: "p2", name: "Linus Bytes", answered: true },
    });
    render(<AdminMatchupList overview={makeOverview({ matchups: [row] })} />);

    const matchupRow = getMatchupRow("Ada Lovelace", "Linus Bytes");
    expect(within(matchupRow).getByText(STATUS_COPY.guessing_unlocked)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Matchup rows — answered indicators
// ---------------------------------------------------------------------------

describe("AdminMatchupList: answered indicators", () => {
  it("shows 'Answered' for playerA when playerA.answered is true", () => {
    const row = makeRow({
      status: "awaiting_one",
      playerA: { id: "p1", name: "Ada Lovelace", answered: true },
      playerB: { id: "p2", name: "Linus Bytes", answered: false },
    });
    render(<AdminMatchupList overview={makeOverview({ matchups: [row] })} />);

    const matchupRow = getMatchupRow("Ada Lovelace", "Linus Bytes");
    const playerASection = within(matchupRow).getByRole("group", {
      name: /Ada Lovelace/i,
    });
    expect(within(playerASection).getByText(ANSWERED_INDICATOR)).toBeInTheDocument();
  });

  it("does NOT show 'Answered' for playerB when playerB.answered is false", () => {
    const row = makeRow({
      status: "awaiting_one",
      playerA: { id: "p1", name: "Ada Lovelace", answered: true },
      playerB: { id: "p2", name: "Linus Bytes", answered: false },
    });
    render(<AdminMatchupList overview={makeOverview({ matchups: [row] })} />);

    const matchupRow = getMatchupRow("Ada Lovelace", "Linus Bytes");
    const playerBSection = within(matchupRow).getByRole("group", {
      name: /Linus Bytes/i,
    });
    expect(within(playerBSection).queryByText(ANSWERED_INDICATOR)).not.toBeInTheDocument();
  });

  it("shows 'Answered' for playerB when playerB.answered is true", () => {
    const row = makeRow({
      status: "awaiting_one",
      playerA: { id: "p1", name: "Ada Lovelace", answered: false },
      playerB: { id: "p2", name: "Linus Bytes", answered: true },
    });
    render(<AdminMatchupList overview={makeOverview({ matchups: [row] })} />);

    const matchupRow = getMatchupRow("Ada Lovelace", "Linus Bytes");
    const playerBSection = within(matchupRow).getByRole("group", {
      name: /Linus Bytes/i,
    });
    expect(within(playerBSection).getByText(ANSWERED_INDICATOR)).toBeInTheDocument();
  });

  it("shows 'Answered' for both players when both have answered", () => {
    const row = makeRow({
      status: "guessing_unlocked",
      playerA: { id: "p1", name: "Ada Lovelace", answered: true },
      playerB: { id: "p2", name: "Linus Bytes", answered: true },
    });
    render(<AdminMatchupList overview={makeOverview({ matchups: [row] })} />);

    const matchupRow = getMatchupRow("Ada Lovelace", "Linus Bytes");
    const playerASection = within(matchupRow).getByRole("group", { name: /Ada Lovelace/i });
    const playerBSection = within(matchupRow).getByRole("group", { name: /Linus Bytes/i });

    expect(within(playerASection).getByText(ANSWERED_INDICATOR)).toBeInTheDocument();
    expect(within(playerBSection).getByText(ANSWERED_INDICATOR)).toBeInTheDocument();
  });

  it("shows no 'Answered' indicators when neither player has answered", () => {
    const row = makeRow({
      status: "awaiting_both",
      playerA: { id: "p1", name: "Ada Lovelace", answered: false },
      playerB: { id: "p2", name: "Linus Bytes", answered: false },
    });
    render(<AdminMatchupList overview={makeOverview({ matchups: [row] })} />);

    const matchupRow = getMatchupRow("Ada Lovelace", "Linus Bytes");
    const allAnsweredText = within(matchupRow).queryAllByText(ANSWERED_INDICATOR);
    expect(allAnsweredText).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Byes section
// ---------------------------------------------------------------------------

describe("AdminMatchupList: byes section", () => {
  it("renders 'No byes this week.' when byePlayers is empty", () => {
    render(<AdminMatchupList overview={makeOverview({ byePlayers: [] })} />);

    const byesRegion = getByesRegion();
    expect(within(byesRegion).getByText(NO_BYES_TEXT)).toBeInTheDocument();
  });

  it("renders bye player names when byePlayers is non-empty", () => {
    const overview = makeOverview({
      byePlayers: [{ id: "p3", name: "Grace Hopper" }],
    });
    render(<AdminMatchupList overview={overview} />);

    const byesRegion = getByesRegion();
    expect(within(byesRegion).getByText("Grace Hopper")).toBeInTheDocument();
  });

  it("does NOT render 'No byes this week.' when byePlayers is non-empty", () => {
    const overview = makeOverview({
      byePlayers: [{ id: "p3", name: "Grace Hopper" }],
    });
    render(<AdminMatchupList overview={overview} />);

    const byesRegion = getByesRegion();
    expect(within(byesRegion).queryByText(NO_BYES_TEXT)).not.toBeInTheDocument();
  });

  it("renders multiple bye player names", () => {
    const overview = makeOverview({
      byePlayers: [
        { id: "p3", name: "Grace Hopper" },
        { id: "p4", name: "Dennis Ritchie" },
      ],
    });
    render(<AdminMatchupList overview={overview} />);

    const byesRegion = getByesRegion();
    expect(within(byesRegion).getByText("Grace Hopper")).toBeInTheDocument();
    expect(within(byesRegion).getByText("Dennis Ritchie")).toBeInTheDocument();
  });
});
