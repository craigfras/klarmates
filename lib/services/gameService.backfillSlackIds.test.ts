/**
 * Tests for GameService.backfillSlackIds — the admin "resolve Slack ids" seam
 * on the mock service (slice 12 cycle B).
 *
 * ============================================================
 * CONTRACT (code-writer must match exactly)
 * ============================================================
 *
 *   backfillSlackIds(): Promise<{ updated: number }>
 *
 *   For each ACTIVE player missing a slackUserId, resolve it via
 *   resolveSlackIdByEmail(player.email) and persist it onto the roster.
 *   Returns { updated: <count of players whose slackUserId was newly set> }.
 *
 * These tests exercise only the NO-TOKEN path: with no SLACK_BOT_TOKEN in the
 * env, resolveSlackIdByEmail() returns null for every email, so nothing is
 * resolved and nothing is persisted. The real Slack lookup is HITL-verified —
 * we deliberately do NOT mock the network here. We only assert that:
 *   - the method exists on the service,
 *   - it resolves to { updated: 0 } without throwing, and
 *   - listRoster() is left unchanged (no slackUserId set on any player).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockGameService } from "@/lib/services/gameService";
import type { Player, Question, WeekStatus } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

/** Week id used as the current open week in the baseline scenario. */
const CURRENT_WEEK_ID = "week-current-2026-25";

/** Number of active players in the baseline scenario, all missing a slack id. */
const ACTIVE_PLAYER_COUNT = 3;

/** Expected backfill count on the no-token path: nothing can be resolved. */
const EXPECTED_UPDATED_NO_TOKEN = 0;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const makePlayer = (id: string, overrides: Partial<Player> = {}): Player => ({
  id,
  name: `Player ${id}`,
  email: `${id}@example.com`,
  isAdmin: false,
  active: true,
  ...overrides,
});

const makeQuestion = (id: string, orderIndex: number): Question => ({
  id,
  orderIndex,
  text: `Question ${id}`,
});

type ServiceData = Parameters<typeof createMockGameService>[0];

/**
 * Baseline: a current open week with ACTIVE_PLAYER_COUNT active players, all
 * lacking a slackUserId. Tests override individual fields as needed.
 */
const buildScenario = (overrides: Partial<ServiceData> = {}): ServiceData => ({
  players: [makePlayer("p1"), makePlayer("p2"), makePlayer("p3")],
  currentWeek: {
    id: CURRENT_WEEK_ID,
    status: "open" as WeekStatus,
    questions: [makeQuestion("q1", 0), makeQuestion("q2", 1)],
  },
  matchups: [],
  byePlayerIds: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Env isolation — guarantee the no-token path
// ---------------------------------------------------------------------------

let savedToken: string | undefined;

beforeEach(() => {
  savedToken = process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_BOT_TOKEN;
});

afterEach(() => {
  if (savedToken === undefined) {
    delete process.env.SLACK_BOT_TOKEN;
  } else {
    process.env.SLACK_BOT_TOKEN = savedToken;
  }
});

// ---------------------------------------------------------------------------
// backfillSlackIds — interface
// ---------------------------------------------------------------------------

describe("gameService.backfillSlackIds: interface", () => {
  it("exposes backfillSlackIds as a function on the service", () => {
    const service = createMockGameService(buildScenario());
    expect(typeof (service as unknown as { backfillSlackIds: unknown }).backfillSlackIds).toBe(
      "function",
    );
  });
});

// ---------------------------------------------------------------------------
// backfillSlackIds — no-token path resolves nothing and leaves roster untouched
// ---------------------------------------------------------------------------

describe("gameService.backfillSlackIds: no Slack token", () => {
  it("resolves to { updated: 0 } without throwing when no token is set", async () => {
    const service = createMockGameService(buildScenario());

    const result = await service.backfillSlackIds();

    expect(result).toEqual({ updated: EXPECTED_UPDATED_NO_TOKEN });
  });

  it("leaves the roster unchanged — no player gains a slackUserId", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);

    await service.backfillSlackIds();

    const roster = await service.listRoster();
    expect(roster).toHaveLength(ACTIVE_PLAYER_COUNT);
    for (const player of roster) {
      // No slackUserId was resolved/persisted on the no-token path.
      expect(player.slackUserId).toBeUndefined();
    }
  });
});
