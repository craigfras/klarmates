/**
 * Slack DM notification builders + dispatch (slice 12).
 *
 * Pure builders turn a player + context into a provider-neutral `SlackMessage`
 * (plain-text fallback, Slack mrkdwn friendly). Notify dispatchers add the
 * "skip when the player isn't slack-linked, otherwise send" policy on top, with
 * the `sendDm` sender injectable (defaults to the real `dm`) so the dispatch
 * logic is unit-testable without the network — mirroring the injectable seams
 * in lib/ai.ts.
 */

import type { Player, Recap } from "@/lib/types";
import { dm, type SlackDm, type SlackMessage } from "@/lib/slack";

// ===========================================================================
// Pure message builders
// ===========================================================================

// ---------------------------------------------------------------------------
// Copy fragments (named, not inline)
// ---------------------------------------------------------------------------

const GREETING = "Hi";

const NEW_WEEK_INTRO = "a new week of Klarmates is open.";
const NEW_WEEK_PROMPT = "Answer this week's questions here:";

const GUESSING_UNLOCKED_LINE =
  "guessing is now unlocked for your matchup — open it up and lock in your guesses!";

const OPPONENT_FINISHED_VERB = "has finished answering";
const OPPONENT_FINISHED_YOUR_TURN =
  "you're up — answer now to unlock guessing for your matchup!";

const GUESSING_COMPLETE_VERB = "has finished guessing your answers";
const GUESSING_COMPLETE_SCORE_LABEL = "They scored";
const GUESSING_COMPLETE_CORRECT_LABEL = "correct";

const END_OF_WEEK_REMINDER =
  "friendly reminder to finish any outstanding answers and guesses before the week wraps up.";

const RESULTS_INTRO = "your weekly results are in!";
const RESULTS_SCORE_LABEL = "Score:";
const RESULTS_CORRECT_JOINER = "of";
const RESULTS_YOU_LABEL = "you";
const RESULTS_OPPONENT_LABEL = "your opponent";
const RESULTS_RANK_LABEL = "Leaderboard rank:";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** A new week is open — prompt to answer; the week link is included verbatim. */
export const buildNewWeekMessage = (
  playerName: string,
  weekLink: string,
): SlackMessage => ({
  text: `${GREETING} ${playerName}, ${NEW_WEEK_INTRO} ${NEW_WEEK_PROMPT} ${weekLink}`,
});

/** Guessing is now unlocked/open for the player's matchup. */
export const buildGuessingUnlockedMessage = (
  playerName: string,
): SlackMessage => ({
  text: `${GREETING} ${playerName}, ${GUESSING_UNLOCKED_LINE}`,
});

/**
 * Nudge to the recipient (who has NOT answered yet) that their opponent
 * (finisherName) has finished answering — it's now their turn so guessing
 * can unlock.
 */
export const buildOpponentFinishedMessage = (
  recipientName: string,
  finisherName: string,
): SlackMessage => ({
  text:
    `${GREETING} ${recipientName}, ${finisherName} ${OPPONENT_FINISHED_VERB} — ` +
    `${OPPONENT_FINISHED_YOUR_TURN}`,
});

/**
 * Nudge to the recipient (whose answers were guessed) that guesserName has
 * finished guessing their answers, reporting the score as
 * correctCount of questionCount correct.
 */
export const buildGuessingCompleteMessage = (
  recipientName: string,
  guesserName: string,
  correctCount: number,
  questionCount: number,
): SlackMessage => ({
  text:
    `${GREETING} ${recipientName}, ${guesserName} ${GUESSING_COMPLETE_VERB}. ` +
    `${GUESSING_COMPLETE_SCORE_LABEL} ${correctCount} ${RESULTS_CORRECT_JOINER} ` +
    `${questionCount} ${GUESSING_COMPLETE_CORRECT_LABEL}.`,
});

/** Friendly reminder to finish outstanding answers/guesses before week end. */
export const buildEndOfWeekReminderMessage = (
  playerName: string,
): SlackMessage => ({
  text: `${GREETING} ${playerName}, ${END_OF_WEEK_REMINDER}`,
});

/** Weekly results — surfaces the score (me of total, opponent) and the rank. */
export const buildWeeklyResultsMessage = (
  playerName: string,
  recap: Recap,
  rank: number,
): SlackMessage => ({
  text:
    `${GREETING} ${playerName}, ${RESULTS_INTRO} ` +
    `${RESULTS_SCORE_LABEL} ${RESULTS_YOU_LABEL} ${recap.meCorrect} ` +
    `${RESULTS_CORRECT_JOINER} ${recap.questionCount}, ` +
    `${RESULTS_OPPONENT_LABEL} ${recap.opponentCorrect}. ` +
    `${RESULTS_RANK_LABEL} ${rank}.`,
});

// ===========================================================================
// Notify dispatchers
// ===========================================================================

// ---------------------------------------------------------------------------
// Shared dispatch guard
// ---------------------------------------------------------------------------

/** Logged when a player has no Slack id, so the notification is skipped. */
const NO_SLACK_ID_WARNING =
  "Player has no slackUserId; skipping Slack notification.";

/**
 * Single source of the "skip when not slack-linked, else send" policy shared by
 * every notify function — avoids duplicating the guard across all four.
 */
const sendToPlayer = async (
  player: Player,
  message: SlackMessage,
  sendDm: SlackDm,
): Promise<void> => {
  if (!player.slackUserId) {
    console.warn(NO_SLACK_ID_WARNING);
    return;
  }
  await sendDm(player.slackUserId, message);
};

// ---------------------------------------------------------------------------
// Dispatchers
// ---------------------------------------------------------------------------

export const notifyNewWeek = async (
  player: Player,
  weekLink: string,
  sendDm: SlackDm = dm,
): Promise<void> =>
  sendToPlayer(player, buildNewWeekMessage(player.name, weekLink), sendDm);

export const notifyGuessingUnlocked = async (
  player: Player,
  sendDm: SlackDm = dm,
): Promise<void> =>
  sendToPlayer(player, buildGuessingUnlockedMessage(player.name), sendDm);

export const notifyOpponentFinished = async (
  recipient: Player,
  finisherName: string,
  sendDm: SlackDm = dm,
): Promise<void> =>
  sendToPlayer(
    recipient,
    buildOpponentFinishedMessage(recipient.name, finisherName),
    sendDm,
  );

export const notifyGuessingComplete = async (
  recipient: Player,
  guesserName: string,
  correctCount: number,
  questionCount: number,
  sendDm: SlackDm = dm,
): Promise<void> =>
  sendToPlayer(
    recipient,
    buildGuessingCompleteMessage(
      recipient.name,
      guesserName,
      correctCount,
      questionCount,
    ),
    sendDm,
  );

export const notifyEndOfWeekReminder = async (
  player: Player,
  sendDm: SlackDm = dm,
): Promise<void> =>
  sendToPlayer(player, buildEndOfWeekReminderMessage(player.name), sendDm);

export const notifyWeeklyResults = async (
  player: Player,
  recap: Recap,
  rank: number,
  sendDm: SlackDm = dm,
): Promise<void> =>
  sendToPlayer(
    player,
    buildWeeklyResultsMessage(player.name, recap, rank),
    sendDm,
  );

// ---------------------------------------------------------------------------
// Fan-out dispatcher
// ---------------------------------------------------------------------------

/**
 * Fans the new-week DM out across a roster, delegating to notifyNewWeek per
 * player. Unlinked players are skipped by the shared guard inside notifyNewWeek,
 * so no extra filtering is needed here. Sequential awaits keep ordering simple;
 * resolves on an empty roster.
 */
export const notifyWeekOpened = async (
  players: Player[],
  weekLink: string,
  sendDm: SlackDm = dm,
): Promise<void> => {
  for (const player of players) {
    await notifyNewWeek(player, weekLink, sendDm);
  }
};

/**
 * Fans the guessing-unlocked DM out across the matchup's players, delegating to
 * notifyGuessingUnlocked per player. Unlinked players are skipped by the shared
 * guard inside notifyGuessingUnlocked, so no extra filtering is needed here.
 * Sequential awaits keep ordering simple; resolves on an empty roster.
 */
export const notifyGuessingUnlockedAll = async (
  players: Player[],
  sendDm: SlackDm = dm,
): Promise<void> => {
  for (const player of players) {
    await notifyGuessingUnlocked(player, sendDm);
  }
};
