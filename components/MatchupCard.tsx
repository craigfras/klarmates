/**
 * MatchupCard — the weekly fixture.
 *
 * The page's hero: the current player versus their opponent, joined by a central
 * "seam" whose state reflects where the pair is in the loop (waiting → live →
 * wrapped) or a solo bye. Rendering only — all state is read from `MyWeekView`,
 * and the status precedence is decided by the `getMatchupStatus` service so this
 * view carries no game logic.
 */

import type { MyWeekView, Player } from "@/lib/types";
import {
  getMatchupStatus,
  type MatchupStatusKind,
} from "@/lib/services/matchupStatus";
import { formatWeekDate } from "@/lib/formatWeekDate";

// ---------------------------------------------------------------------------
// Presentation maps (copy + tone live here, in the view)
// ---------------------------------------------------------------------------

type Tone = "neutral" | "pending" | "live" | "done";

type StatusCopy = {
  tone: Tone;
  headline: string;
  detail: (opponentName: string) => string;
};

const WEEK_STATUS_LABEL: Record<MyWeekView["status"], string> = {
  draft_questions: "Draft",
  awaiting_approval: "Awaiting approval",
  open: "Open",
  closed: "Closed",
};

const STATUS_COPY: Record<MatchupStatusKind, StatusCopy> = {
  answer_needed: {
    tone: "pending",
    headline: "Your move",
    detail: () => "Answer this week's four questions about yourself to get in the game.",
  },
  waiting_opponent: {
    tone: "pending",
    headline: "Answers in",
    detail: (name) => `You're done. Guessing opens as soon as ${name} answers.`,
  },
  guessing_unlocked: {
    tone: "live",
    headline: "Guessing is open",
    detail: (name) => `You've both answered — time to guess ${name}'s answers.`,
  },
  // Guessing finished (all questions guessed); still live until the week closes.
  guessing_complete: {
    tone: "done",
    headline: "Guessing complete",
    detail: (name) => `You've guessed all of ${name}'s answers — see how you did when the week wraps.`,
  },
  recap: {
    tone: "done",
    headline: "Week wrapped",
    detail: (name) => `Here's how you and ${name} did this week.`,
  },
  bye: {
    tone: "neutral",
    headline: "You're on a bye",
    detail: () => "No opponent this week — you'll be back in the draw next week. Scores 0.",
  },
};

const SEAM_DEFAULT_BADGE = "VS";
const QUESTIONS_LABEL = "Questions in play";

// The score detail surfaced once guessing is complete. Keeps the "N of M"
// phrasing contiguous and names the opponent without a doubled "of".
const buildCompleteDetail = (
  correct: number,
  total: number,
  opponentName: string,
): string =>
  `Against ${opponentName}, you guessed ${correct} of ${total} correctly.`;

// ---------------------------------------------------------------------------
// Small render helpers
// ---------------------------------------------------------------------------

const handleFromEmail = (email: string): string => `@${email.split("@")[0]}`;

function PlayerSide({
  player,
  label,
  answered,
  side,
}: {
  player: Player;
  label: string;
  answered: boolean;
  side: "you" | "opp";
}) {
  return (
    <div className={`side ${side === "you" ? "side-you" : "side-opp"}`}>
      <span className="side-label">{label}</span>
      <span className="side-name">{player.name}</span>
      <span className="side-handle mono">{handleFromEmail(player.email)}</span>
      <span className="side-pip">
        <span className={`side-pip-dot ${answered ? "is-on" : ""}`} />
        {answered ? "Answered" : "Not yet"}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type MatchupCardProps = {
  view: MyWeekView;
  me: Player;
};

export function MatchupCard({ view, me }: MatchupCardProps) {
  const kind = getMatchupStatus(view);
  const copy = STATUS_COPY[kind];
  const opponentName = view.opponent?.name ?? "your opponent";

  const statusDetail =
    kind === "guessing_complete"
      ? buildCompleteDetail(
          view.myCorrectGuesses,
          view.questions.length,
          opponentName,
        )
      : copy.detail(opponentName);

  const seamState =
    kind === "guessing_unlocked" || kind === "guessing_complete"
      ? "is-live"
      : kind === "bye"
        ? "is-bye"
        : "";
  const seamBadge = kind === "bye" ? "Bye" : SEAM_DEFAULT_BADGE;

  return (
    <article className="fixture">
      {/* --- Eyebrow: which week, what state --- */}
      <header className="fixture-eyebrow">
        <span>Week</span>
        <span className="fixture-week mono">{formatWeekDate(view.startsAt)}</span>
        <span className="fixture-eyebrow-dot" />
        <span>{WEEK_STATUS_LABEL[view.status]}</span>
      </header>

      {/* --- Head-to-head: you · seam · opponent --- */}
      <div className="fixture-head">
        <PlayerSide
          player={me}
          label="You"
          answered={view.myAnswersSubmitted}
          side="you"
        />

        <div className={`seam ${seamState}`} aria-hidden="true">
          <span className="seam-badge">{seamBadge}</span>
        </div>

        {view.opponent ? (
          <PlayerSide
            player={view.opponent}
            label="Opponent"
            answered={view.opponentAnswered}
            side="opp"
          />
        ) : (
          <div className="side side-opp side-empty">
            <span className="side-label">Opponent</span>
            <span className="side-name">No opponent</span>
            <span className="side-handle mono">bye week</span>
          </div>
        )}
      </div>

      {/* --- The four questions in play --- */}
      <section className="questions">
        <h2 className="questions-label">{QUESTIONS_LABEL}</h2>
        <div className="questions-grid">
          {view.questions.map((question) => (
            <div className="question" key={question.id}>
              <span className="question-tick mono" aria-hidden="true">
                ?
              </span>
              <p className="question-text">{question.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* --- Status: where this pair stands --- */}
      <footer className={`statusbar tone-${copy.tone}`}>
        <div className="status-text">
          <p className="status-headline">
            <span className="status-flag" aria-hidden="true" />
            {copy.headline}
          </p>
          <p className="status-detail">{statusDetail}</p>
        </div>

        {kind === "recap" && view.recap && (
          <div className="recap">
            <span className="recap-tally">
              <span className="recap-score recap-score-mine">
                {view.recap.meCorrect}
              </span>
              <span className="recap-vs">you</span>
            </span>
            <span className="recap-vs">/</span>
            <span className="recap-tally">
              <span className="recap-score">{view.recap.opponentCorrect}</span>
              <span className="recap-vs">{opponentName}</span>
            </span>
          </div>
        )}
      </footer>
    </article>
  );
}
