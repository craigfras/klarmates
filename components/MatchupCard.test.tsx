import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MatchupCard } from "@/components/MatchupCard";
import type { MyWeekView, Player, Question } from "@/lib/types";

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

// The eyebrow shows the week's START DATE, not the raw week id. These constants
// pin the ISO input and the exact human format the view must render, using
// Intl.DateTimeFormat("en-US", { year, month: "short", day, timeZone: "UTC" }).
const WEEK_STARTS_AT_ISO = "2026-06-22T00:00:00.000Z";
const WEEK_STARTS_AT_FORMATTED = "Jun 22, 2026";
const RAW_WEEK_ID = "week-2026-25";

const makePlayer = (overrides: Partial<Player> = {}): Player => ({
  id: "player-me",
  name: "Me Myself",
  email: "me@getklar.com",
  isAdmin: false,
  active: true,
  ...overrides,
});

const FOUR_QUESTIONS: Question[] = [
  { id: "q0", orderIndex: 0, text: "First question text?" },
  { id: "q1", orderIndex: 1, text: "Second question text?" },
  { id: "q2", orderIndex: 2, text: "Third question text?" },
  { id: "q3", orderIndex: 3, text: "Fourth question text?" },
];

const makeView = (overrides: Partial<MyWeekView> = {}): MyWeekView => ({
  weekId: RAW_WEEK_ID,
  startsAt: WEEK_STARTS_AT_ISO,
  status: "open",
  opponent: makePlayer({ id: "player-opp", name: "Opponent Name", email: "opp@getklar.com" }),
  isBye: false,
  questions: FOUR_QUESTIONS,
  myAnswersSubmitted: false,
  opponentAnswered: false,
  guessingUnlocked: false,
  guessingComplete: false,
  myCorrectGuesses: 0,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MatchupCard", () => {
  it("renders my name, opponent name, and all four question texts", () => {
    const me = makePlayer({ name: "Ada Lovelace" });
    render(<MatchupCard view={makeView()} me={me} />);

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Opponent Name")).toBeInTheDocument();

    for (const q of FOUR_QUESTIONS) {
      expect(screen.getByText(q.text)).toBeInTheDocument();
    }
  });

  // -------------------------------------------------------------------------
  // Eyebrow: the week is shown as a human date, never the raw week id
  // -------------------------------------------------------------------------

  it("renders the week's start date (formatted) in the eyebrow, not the raw week id", () => {
    render(<MatchupCard view={makeView()} me={makePlayer()} />);

    // The formatted start date is shown.
    expect(screen.getByText(/Jun 22, 2026/)).toBeInTheDocument();
    expect(screen.getByText(WEEK_STARTS_AT_FORMATTED)).toBeInTheDocument();

    // The raw week id must NOT leak into the UI.
    expect(screen.queryByText(RAW_WEEK_ID)).toBeNull();
  });

  it("cold-start (empty startsAt) does not render an 'Invalid Date' string", () => {
    render(<MatchupCard view={makeView({ startsAt: "" })} me={makePlayer()} />);

    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it("guessing_unlocked → shows 'Guessing is open' and the seam carries is-live", () => {
    const { container } = render(
      <MatchupCard
        view={makeView({ myAnswersSubmitted: true, opponentAnswered: true })}
        me={makePlayer()}
      />,
    );

    expect(screen.getByText("Guessing is open")).toBeInTheDocument();

    const seam = container.querySelector(".seam");
    expect(seam).not.toBeNull();
    expect(seam).toHaveClass("is-live");
  });

  it("guessing_complete → shows distinct 'complete' copy, different from the open/live copy", () => {
    // Same precedence inputs as guessing_unlocked but guessingComplete=true so
    // getMatchupStatus resolves to "guessing_complete".
    const completeView = makeView({
      guessingUnlocked: true,
      guessingComplete: true,
      myAnswersSubmitted: true,
      opponentAnswered: true,
    });
    const { container } = render(
      <MatchupCard view={completeView} me={makePlayer()} />,
    );

    // The headline conveys that guessing is COMPLETE.
    expect(screen.getByText(/complete/i)).toBeInTheDocument();

    // The "open / time to guess" live copy must NOT be the headline here.
    expect(screen.queryByText("Guessing is open")).toBeNull();

    // The complete headline differs from the guessing_unlocked headline.
    const completeHeadline =
      container.querySelector(".status-headline")?.textContent ?? "";

    const openView = makeView({
      guessingUnlocked: true,
      guessingComplete: false,
      myAnswersSubmitted: true,
      opponentAnswered: true,
    });
    const { container: openContainer } = render(
      <MatchupCard view={openView} me={makePlayer()} />,
    );
    const openHeadline =
      openContainer.querySelector(".status-headline")?.textContent ?? "";

    expect(completeHeadline).not.toBe(openHeadline);
    expect(openHeadline).toMatch(/open|guess/i);
  });

  // -------------------------------------------------------------------------
  // guessing_complete: the status detail surfaces the player's week score
  // (how many of the opponent's answers they guessed correctly, out of total)
  // -------------------------------------------------------------------------

  it("guessing_complete → status detail surfaces the player's score as 'N of M'", () => {
    // Four questions in play, three guessed correctly → score reads "3 of 4".
    const MY_CORRECT_GUESSES = 3;
    const QUESTION_COUNT = FOUR_QUESTIONS.length; // 4
    expect(QUESTION_COUNT).toBe(4);

    const completeView = makeView({
      guessingUnlocked: true,
      guessingComplete: true,
      myAnswersSubmitted: true,
      opponentAnswered: true,
      myCorrectGuesses: MY_CORRECT_GUESSES,
      questions: FOUR_QUESTIONS,
    });

    const { container } = render(
      <MatchupCard view={completeView} me={makePlayer()} />,
    );

    // The score appears together in an "N of M" phrasing within the detail.
    expect(screen.getByText(/3 of 4/)).toBeInTheDocument();

    // Scope to the .status-detail to assert BOTH numbers live in the detail,
    // adjacent (correct count before the total).
    const detail = container.querySelector(".status-detail");
    expect(detail).not.toBeNull();
    expect(detail?.textContent ?? "").toMatch(/3\D+4/);
  });

  it("guessing_complete with a zero score → status detail shows '0 of 4'", () => {
    const completeView = makeView({
      guessingUnlocked: true,
      guessingComplete: true,
      myAnswersSubmitted: true,
      opponentAnswered: true,
      myCorrectGuesses: 0,
      questions: FOUR_QUESTIONS,
    });

    const { container } = render(
      <MatchupCard view={completeView} me={makePlayer()} />,
    );

    expect(screen.getByText(/0 of 4/)).toBeInTheDocument();

    const detail = container.querySelector(".status-detail");
    expect(detail?.textContent ?? "").toMatch(/0\D+4/);
  });

  it("waiting_opponent (mine in, opponent not) → shows 'Answers in'", () => {
    render(
      <MatchupCard
        view={makeView({ myAnswersSubmitted: true, opponentAnswered: false })}
        me={makePlayer()}
      />,
    );

    expect(screen.getByText("Answers in")).toBeInTheDocument();
  });

  it("answer_needed (nothing submitted) → shows 'Your move'", () => {
    render(
      <MatchupCard
        view={makeView({ myAnswersSubmitted: false, opponentAnswered: false })}
        me={makePlayer()}
      />,
    );

    expect(screen.getByText("Your move")).toBeInTheDocument();
  });

  it("bye view → renders the empty opponent side, bye headline, bye seam badge; no opponent name", () => {
    const { container } = render(
      <MatchupCard
        view={makeView({ isBye: true, opponent: null })}
        me={makePlayer({ name: "Margaret Hamilton" })}
      />,
    );

    // Empty opponent side
    expect(screen.getByText("No opponent")).toBeInTheDocument();
    expect(screen.getByText("bye week")).toBeInTheDocument();

    // Bye headline
    expect(screen.getByText("You're on a bye")).toBeInTheDocument();

    // Seam carries bye badge + bye state
    const seam = container.querySelector(".seam");
    expect(seam).not.toBeNull();
    expect(seam).toHaveClass("is-bye");
    expect(screen.getByText("Bye")).toBeInTheDocument();

    // Opponent name absent
    expect(screen.queryByText("Opponent Name")).not.toBeInTheDocument();
  });

  it("closed view with a recap → renders recap headline and the correct counts", () => {
    render(
      <MatchupCard
        view={makeView({
          status: "closed",
          myAnswersSubmitted: true,
          opponentAnswered: true,
          recap: { meCorrect: 3, opponentCorrect: 2, questionCount: 4 },
        })}
        me={makePlayer()}
      />,
    );

    expect(screen.getByText("Week wrapped")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
