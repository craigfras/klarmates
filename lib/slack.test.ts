/**
 * Tests for the slice 12 Slack client seam in "@/lib/slack".
 *
 * CONTRACT (intended new exports):
 *   - type SlackMessage = { text: string; blocks?: unknown[] }
 *   - type SlackDm = (slackUserId: string, message: SlackMessage) => Promise<void>
 *   - const dm: SlackDm
 *       Real sender. Lazily builds a WebClient from process.env.SLACK_BOT_TOKEN
 *       and calls chat.postMessage. When the token is unset/empty it logs and
 *       NO-OPS (never throws). Errors are caught/logged, never thrown.
 *   - const resolveSlackIdByEmail: (email: string) => Promise<string | null>
 *       Uses users.lookupByEmail; returns the slack id, or null when the token
 *       is missing / the user is not found / on any error.
 *
 * We only exercise the NO-TOKEN behaviour here — the real Slack API path is
 * HITL-verified and intentionally not unit-tested (no network, no real
 * WebClient assertions).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { dm, resolveSlackIdByEmail } from "@/lib/slack";

// ---------------------------------------------------------------------------
// Constants (no repeated magic strings)
// ---------------------------------------------------------------------------

const SLACK_BOT_TOKEN_ENV = "SLACK_BOT_TOKEN";
const SLACK_USER_ID = "U123";
const LOOKUP_EMAIL = "ada@getklar.com";

// ---------------------------------------------------------------------------
// No-token environment: save + clear the token, restore afterwards
// ---------------------------------------------------------------------------

describe("slack: behaviour with no SLACK_BOT_TOKEN", () => {
  let savedToken: string | undefined;

  beforeEach(() => {
    savedToken = process.env[SLACK_BOT_TOKEN_ENV];
    delete process.env[SLACK_BOT_TOKEN_ENV];
  });

  afterEach(() => {
    if (savedToken === undefined) {
      delete process.env[SLACK_BOT_TOKEN_ENV];
    } else {
      process.env[SLACK_BOT_TOKEN_ENV] = savedToken;
    }
  });

  it("dm() resolves to undefined (no-op) without throwing when the token is missing", async () => {
    await expect(dm(SLACK_USER_ID, { text: "hi" })).resolves.toBeUndefined();
  });

  it("resolveSlackIdByEmail() resolves to null when the token is missing", async () => {
    await expect(resolveSlackIdByEmail(LOOKUP_EMAIL)).resolves.toBeNull();
  });
});
