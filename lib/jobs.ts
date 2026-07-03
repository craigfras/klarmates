/**
 * Scheduled-job bodies for Vercel Cron (slice 13).
 *
 * Each job is a thin orchestrator over the existing game service, notifications
 * and Prisma. To keep the orchestration unit-testable without a DB / network,
 * every job takes an OPTIONAL `deps` object whose defaults wire the real
 * collaborators — mirroring the injectable seams in lib/notifications.ts and
 * lib/ai.ts. Tests inject fakes; production runs the defaults.
 *
 * Idempotency:
 *  - draftNextWeek delegates to getDraftQuestions, which creates the
 *    awaiting_approval draft only if none exists (safe to re-run).
 *  - closeOpenWeek only acts on an OPEN week whose endsAt has passed; once
 *    closed there is no such week, so a repeat run no-ops.
 *
 * Notifications never throw and no-op without a Slack token, so awaiting them
 * inside these jobs can never abort the loop.
 *
 * Server-only.
 */

import type { MyWeekView, Player, Question, Recap, WeekStatus } from "@/lib/types";
import { UPCOMING_WEEK_ID } from "@/lib/types";
import { gameService } from "@/lib/services";
import {
  notifyEndOfWeekReminder,
  notifyWeeklyResults,
} from "@/lib/notifications";
import { getPrisma } from "@/lib/db/client";
import type { SeasonWindow } from "@/lib/season";
import { isSeasonExpired, nextQuarterAfter } from "@/lib/season";

// ===========================================================================
// Constants
// ===========================================================================

const OPEN_STATUS: WeekStatus = "open";

/** Leaderboard scope used to resolve each participant's season rank. */
const SEASON_SCOPE = "season" as const;

/** Rank assigned when a participant is absent from the leaderboard. */
const UNRANKED = 0;

// ===========================================================================
// isOutstanding — pure "does the player still have work THIS week?" predicate
// ===========================================================================

/**
 * True when the player still owes work for an open, non-bye week: either they
 * have not submitted answers, or guessing is unlocked but not yet complete.
 */
export const isOutstanding = (view: MyWeekView): boolean =>
  view.status === OPEN_STATUS &&
  !view.isBye &&
  (!view.myAnswersSubmitted ||
    (view.guessingUnlocked && !view.guessingComplete));

// ===========================================================================
// draftNextWeek — draft questions for the upcoming week
// ===========================================================================

export type DraftDeps = {
  getDraftQuestions: (weekId: string) => Promise<Question[]>;
};

const defaultDraftDeps: DraftDeps = {
  getDraftQuestions: (id) => gameService.getDraftQuestions(id),
};

/**
 * Ensures the upcoming week's draft questions exist (idempotent via
 * getDraftQuestions) and reports how many there are. Does NOT open the week.
 */
export const draftNextWeek = async (
  deps: DraftDeps = defaultDraftDeps,
): Promise<{ weekId: string; questionCount: number }> => {
  const questions = await deps.getDraftQuestions(UPCOMING_WEEK_ID);
  return { weekId: UPCOMING_WEEK_ID, questionCount: questions.length };
};

// ===========================================================================
// sendEndOfWeekReminders — notify only ACTIVE players with outstanding work
// ===========================================================================

export type ReminderDeps = {
  listRoster: () => Promise<Player[]>;
  getMyWeek: (playerId: string) => Promise<MyWeekView>;
  notify: (player: Player) => Promise<void>;
};

const defaultReminderDeps: ReminderDeps = {
  listRoster: () => gameService.listRoster(),
  getMyWeek: (id) => gameService.getMyWeek(id),
  notify: (p) => notifyEndOfWeekReminder(p),
};

/**
 * DMs a friendly reminder to every ACTIVE player whose current week still has
 * outstanding work (see isOutstanding). Returns how many reminders were sent.
 */
export const sendEndOfWeekReminders = async (
  deps: ReminderDeps = defaultReminderDeps,
): Promise<{ sent: number }> => {
  let sent = 0;
  const roster = await deps.listRoster();
  for (const player of roster) {
    if (!player.active) {
      continue;
    }
    const view = await deps.getMyWeek(player.id);
    if (isOutstanding(view)) {
      await deps.notify(player);
      sent += 1;
    }
  }
  return { sent };
};

// ===========================================================================
// closeOpenWeek — close a closable week + DM results; guard on the null path
// ===========================================================================

export type CloseResult = { player: Player; recap: Recap; rank: number };

export type CloseDeps = {
  findClosableWeekId: () => Promise<string | null>;
  close: (weekId: string) => Promise<void>;
  getResults: (weekId: string) => Promise<CloseResult[]>;
  notifyResult: (player: Player, recap: Recap, rank: number) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Default close deps — the DB-coupled bits (build-verified, not unit-tested)
// ---------------------------------------------------------------------------

/**
 * The single open week whose end has passed, or null. The endsAt<=now guard is
 * what makes the close job idempotent: after the week flips to closed there is
 * no matching row, so a repeat run finds nothing to close.
 */
const findClosableWeekId = async (): Promise<string | null> => {
  const prisma = getPrisma();
  const week = await prisma.week.findFirst({
    where: { status: OPEN_STATUS, endsAt: { lte: new Date() } },
    orderBy: { startsAt: "desc" },
  });
  return week?.id ?? null;
};

/**
 * Gathers per-participant results for a just-closed week by reusing existing
 * service methods (no bespoke query logic): season ranks come from the
 * leaderboard, recaps from each player's history. Bye players get no
 * head-to-head recap, so they are naturally excluded (only matchup
 * participants are considered, and only those with a found recap are returned).
 */
const getClosedWeekResults = async (
  weekId: string,
): Promise<CloseResult[]> => {
  const prisma = getPrisma();

  // Rank map: playerId -> season rank.
  const leaderboard = await gameService.getLeaderboard(SEASON_SCOPE);
  const rankByPlayer = new Map(
    leaderboard.map((row) => [row.playerId, row.rank]),
  );

  // Matchup participants for this week (byes have no matchup → skipped).
  // De-dupe so a player can never be DM'd twice, even if the pairing invariant
  // (one matchup per player per week) is ever violated upstream.
  const matchups = await prisma.matchup.findMany({ where: { weekId } });
  const participantIds = [
    ...new Set(matchups.flatMap((m) => [m.playerAId, m.playerBId])),
  ];

  const results: CloseResult[] = [];
  for (const playerId of participantIds) {
    const player = await prisma.player.findUnique({ where: { id: playerId } });
    if (!player) {
      continue;
    }
    const recap = (await gameService.getMyHistory(playerId)).find(
      (h) => h.weekId === weekId,
    )?.recap;
    if (!recap) {
      continue;
    }
    results.push({
      player: {
        id: player.id,
        name: player.name,
        email: player.email,
        slackUserId: player.slackUserId ?? undefined,
        isAdmin: player.isAdmin,
        active: player.active,
      },
      recap,
      rank: rankByPlayer.get(playerId) ?? UNRANKED,
    });
  }
  return results;
};

const defaultCloseDeps: CloseDeps = {
  findClosableWeekId,
  close: (id) => gameService.closeWeek(id),
  getResults: (id) => getClosedWeekResults(id),
  notifyResult: (p, recap, rank) => notifyWeeklyResults(p, recap, rank),
};

/**
 * Closes the one closable week (if any), then DMs each matchup participant
 * their weekly results. No-ops when there is nothing to close (the "no
 * double-close / no double-DM" contract).
 */
export const closeOpenWeek = async (
  deps: CloseDeps = defaultCloseDeps,
): Promise<{ closed: boolean; weekId?: string }> => {
  const weekId = await deps.findClosableWeekId();
  if (!weekId) {
    return { closed: false };
  }
  await deps.close(weekId);
  const results = await deps.getResults(weekId);
  for (const r of results) {
    await deps.notifyResult(r.player, r.recap, r.rank);
  }
  return { closed: true, weekId };
};

// ===========================================================================
// closeCurrentWeek — FORCE variant: close ANY open week regardless of endsAt
// ===========================================================================
//
// Shares closeOpenWeek's orchestration verbatim (it delegates to it) but swaps
// the default finder for one that drops the endsAt<=now guard, so an admin can
// close the open week early. The finder is DB-coupled (build-verified, not
// unit-tested) — mirroring findClosableWeekId above.

/**
 * The latest open week, REGARDLESS of endsAt. Unlike findClosableWeekId this
 * has no endsAt<=now guard, so it also matches a still-running open week — the
 * whole point of the force variant. Not idempotent by itself; that is fine
 * because the force path is an explicit manual admin action.
 */
const findOpenWeekId = async (): Promise<string | null> => {
  const prisma = getPrisma();
  const week = await prisma.week.findFirst({
    where: { status: OPEN_STATUS },
    orderBy: { startsAt: "desc" },
  });
  return week?.id ?? null;
};

const defaultForceCloseDeps: CloseDeps = {
  ...defaultCloseDeps,
  findClosableWeekId: findOpenWeekId,
};

/**
 * Force-closes the latest open week (if any) via the shared closeOpenWeek
 * orchestration, ignoring the endsAt<=now guard. No-ops when there is no open
 * week to close.
 */
export const closeCurrentWeek = async (
  deps: CloseDeps = defaultForceCloseDeps,
): Promise<{ closed: boolean; weekId?: string }> => closeOpenWeek(deps);

// ===========================================================================
// rolloverSeasonIfDue — start the next quarter's season when the current expires
// ===========================================================================

export type RolloverDeps = {
  getCurrentSeason: () => Promise<{ id: string; endsOn: Date } | null>;
  rollover: (
    currentSeasonId: string,
    next: SeasonWindow,
  ) => Promise<{ id: string }>;
};

// ---------------------------------------------------------------------------
// Default rollover deps — the DB-coupled bits (build-verified, not unit-tested)
// ---------------------------------------------------------------------------

/**
 * The current season (isCurrent = true), or null when none is flagged. Its
 * endsOn drives the expiry check that makes this job idempotent: once the next
 * season is current, its (future) endsOn no longer satisfies isSeasonExpired,
 * so a repeat run no-ops.
 */
const getCurrentSeasonRow = async (): Promise<{
  id: string;
  endsOn: Date;
} | null> => {
  const prisma = getPrisma();
  const season = await prisma.season.findFirst({
    where: { isCurrent: true },
    select: { id: true, endsOn: true },
  });
  return season ?? null;
};

/**
 * Flips the old season off-current and makes the next quarter current, in one
 * transaction. Defensive against a duplicate next-season row: the Season model
 * has NO uniqueness on startsOn, so a re-run (or racing cron) could otherwise
 * create a second row for the same quarter. We therefore look up any existing
 * season with the same startsOn BEFORE the tx (mirroring closeWeek's read-first
 * pattern, keeping the tx write-only) and, if found, re-flag it current instead
 * of creating a duplicate. Returns the id of the resulting current season.
 */
const rolloverSeason = async (
  currentSeasonId: string,
  next: SeasonWindow,
): Promise<{ id: string }> => {
  const prisma = getPrisma();

  // Read-before-tx: has the next quarter's season already been created?
  const existingNext = await prisma.season.findFirst({
    where: { startsOn: next.startsOn },
    select: { id: true },
  });

  if (existingNext) {
    await prisma.$transaction(async (tx) => {
      await tx.season.update({
        where: { id: currentSeasonId },
        data: { isCurrent: false },
      });
      await tx.season.update({
        where: { id: existingNext.id },
        data: { isCurrent: true },
      });
    });
    return { id: existingNext.id };
  }

  const created = await prisma.$transaction(async (tx) => {
    await tx.season.update({
      where: { id: currentSeasonId },
      data: { isCurrent: false },
    });
    return tx.season.create({
      data: {
        name: next.name,
        startsOn: next.startsOn,
        endsOn: next.endsOn,
        isCurrent: true,
      },
      select: { id: true },
    });
  });
  return { id: created.id };
};

const defaultRolloverDeps: RolloverDeps = {
  getCurrentSeason: getCurrentSeasonRow,
  rollover: (currentSeasonId, next) => rolloverSeason(currentSeasonId, next),
};

/**
 * Rolls the current season into the next quarter IFF it has expired (its endsOn
 * UTC day is strictly before today's UTC day). No current season, or one that
 * has not yet expired, is a clean no-op. Leaderboards/pairing reset naturally
 * because reads are scoped to the current season (no destructive migration).
 */
export const rolloverSeasonIfDue = async (
  today: Date,
  deps: RolloverDeps = defaultRolloverDeps,
): Promise<{ rolledOver: boolean; newSeasonId?: string }> => {
  const current = await deps.getCurrentSeason();
  if (!current) {
    return { rolledOver: false };
  }
  if (!isSeasonExpired(today, current.endsOn)) {
    return { rolledOver: false };
  }
  const next = nextQuarterAfter(current.endsOn);
  const created = await deps.rollover(current.id, next);
  return { rolledOver: true, newSeasonId: created.id };
};

// ===========================================================================
// forceRolloverSeason — FORCE variant: roll over even when NOT expired
// ===========================================================================
//
// Identical to rolloverSeasonIfDue but WITHOUT the isSeasonExpired guard, so an
// admin can start the next quarter's season early. Reuses defaultRolloverDeps.

/**
 * Rolls the current season into the next quarter unconditionally (skipping the
 * expiry guard). No current season is still a clean no-op.
 */
export const forceRolloverSeason = async (
  today: Date,
  deps: RolloverDeps = defaultRolloverDeps,
): Promise<{ rolledOver: boolean; newSeasonId?: string }> => {
  const current = await deps.getCurrentSeason();
  if (!current) {
    return { rolledOver: false };
  }
  const next = nextQuarterAfter(current.endsOn);
  const created = await deps.rollover(current.id, next);
  return { rolledOver: true, newSeasonId: created.id };
};
