import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecapCard } from "@/components/RecapCard";
import type { Recap } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers & constants
// ---------------------------------------------------------------------------

const makeRecap = (overrides: Partial<Recap> = {}): Recap => ({
  meCorrect: 3,
  opponentCorrect: 2,
  questionCount: 4,
  ...overrides,
});

const OPPONENT_NAME = "Grace Hopper";

/** A valid ISO week-start that formatWeekDate renders as "Jun 8, 2026". */
const WEEK_STARTS_AT = "2026-06-08T00:00:00.000Z";
const FORMATTED_WEEK_DATE = /Jun 8, 2026/;

// ---------------------------------------------------------------------------
// head-to-head rendering
// ---------------------------------------------------------------------------

describe("RecapCard: head-to-head", () => {
  it("renders the player's score as 'You X/Q'", () => {
    render(
      <RecapCard
        recap={makeRecap()}
        opponentName={OPPONENT_NAME}
        weekStartsAt={WEEK_STARTS_AT}
      />,
    );

    expect(screen.getByText(/You\s+3\/4/i)).toBeInTheDocument();
  });

  it("renders the opponent's score as '<opponent> Y/Q'", () => {
    render(
      <RecapCard
        recap={makeRecap()}
        opponentName={OPPONENT_NAME}
        weekStartsAt={WEEK_STARTS_AT}
      />,
    );

    expect(
      screen.getByText(/Grace Hopper\s+2\/4/i),
    ).toBeInTheDocument();
  });

  it("reflects different recap values", () => {
    render(
      <RecapCard
        recap={makeRecap({ meCorrect: 4, opponentCorrect: 0, questionCount: 4 })}
        opponentName="Dennis Ritchie"
        weekStartsAt={WEEK_STARTS_AT}
      />,
    );

    expect(screen.getByText(/You\s+4\/4/i)).toBeInTheDocument();
    expect(screen.getByText(/Dennis Ritchie\s+0\/4/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// week-date heading
// ---------------------------------------------------------------------------

describe("RecapCard: week-date heading", () => {
  it("renders a formatted week-date heading when weekStartsAt is valid", () => {
    render(
      <RecapCard
        recap={makeRecap()}
        opponentName={OPPONENT_NAME}
        weekStartsAt={WEEK_STARTS_AT}
      />,
    );

    // The formatted date appears, reading like a week label ("Week of ...").
    const heading = screen.getByText(FORMATTED_WEEK_DATE);
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent(/week/i);

    // The raw ISO string / week id is never surfaced to the player.
    expect(screen.queryByText(WEEK_STARTS_AT)).toBeNull();
    expect(screen.queryByText(/week-2026/i)).toBeNull();
  });

  it("renders no week heading and no 'Invalid Date' when weekStartsAt is empty", () => {
    render(
      <RecapCard
        recap={makeRecap()}
        opponentName={OPPONENT_NAME}
        weekStartsAt=""
      />,
    );

    // No week heading, and never the JS "Invalid Date" sentinel.
    expect(screen.queryByText(/week of/i)).toBeNull();
    expect(screen.queryByText(/invalid date/i)).toBeNull();

    // The recap tally still renders as before.
    expect(screen.getByText(/You\s+3\/4/i)).toBeInTheDocument();
    expect(screen.getByText(/Grace Hopper\s+2\/4/i)).toBeInTheDocument();
  });
});
