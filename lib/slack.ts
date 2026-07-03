/**
 * Slack client seam (slice 12).
 *
 * Server-side only DM sender + email→id resolver for the Engineer Guessing
 * Game. The Slack SDK (`@slack/web-api`) is imported DYNAMICALLY inside each
 * function so it is never pulled into an edge/client bundle (mirrors the lazy
 * dynamic-import pattern for the Gemini SDK in lib/ai.ts).
 *
 * The bot token is read only from `process.env.SLACK_BOT_TOKEN` and is never
 * returned or logged. When the token is missing, every operation NO-OPS safely
 * (logs a warning and returns) — a failed/disabled DM must never break the
 * caller, so all network errors are caught and logged, never thrown.
 */

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

/** A Slack message: plain-text fallback/summary plus optional rich blocks. */
export type SlackMessage = { text: string; blocks?: unknown[] };

/** Sends one direct message to a Slack user. Resolves even on failure. */
export type SlackDm = (
  slackUserId: string,
  message: SlackMessage,
) => Promise<void>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Logged once when the bot token is unset so notifications are disabled. */
const NO_TOKEN_WARNING =
  "SLACK_BOT_TOKEN is not set; Slack notification skipped (no-op).";

/** Logged when a Slack API call fails (the error itself is not thrown). */
const SEND_FAILED_WARNING = "Slack DM failed; ignoring.";

/** Logged when an email→id lookup fails or finds no user. */
const LOOKUP_FAILED_WARNING =
  "Slack email lookup failed or user not found; returning null.";

// ---------------------------------------------------------------------------
// Token + client helpers
// ---------------------------------------------------------------------------

/** Reads a non-empty, trimmed SLACK_BOT_TOKEN from the environment, or undefined. */
const readSlackToken = (): string | undefined => {
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  return token && token.length > 0 ? token : undefined;
};

/**
 * Lazily builds a Slack WebClient from the given token. The SDK import lives
 * here so it is loaded only on a real token path, never statically.
 */
const createSlackClient = async (token: string) => {
  const { WebClient } = await import("@slack/web-api");
  return new WebClient(token);
};

/** The Slack SDK's rich-block array shape; used only to cast at the API boundary. */
type SlackBlocks = (
  | import("@slack/web-api").Block
  | import("@slack/web-api").KnownBlock
)[];

// ---------------------------------------------------------------------------
// Direct message sender
// ---------------------------------------------------------------------------

/**
 * Real DM sender. NO-OPS (logs + returns) when the token is missing, and
 * catches/logs any API error so a failed send never throws to the caller.
 */
export const dm: SlackDm = async (slackUserId, message) => {
  const token = readSlackToken();
  if (!token) {
    console.warn(NO_TOKEN_WARNING);
    return;
  }

  try {
    const client = await createSlackClient(token);
    await client.chat.postMessage({
      channel: slackUserId,
      text: message.text,
      // The contract keeps `blocks` provider-neutral (`unknown[]`); the SDK
      // types it as its own block union, so we cast only at this boundary.
      blocks: message.blocks as SlackBlocks | undefined,
    });
  } catch (error) {
    console.warn(SEND_FAILED_WARNING, error);
  }
};

// ---------------------------------------------------------------------------
// Email → Slack id resolver
// ---------------------------------------------------------------------------

/**
 * Resolves a Slack user id from an email. Returns null when the token is
 * missing, the user is not found, or any error occurs (incl. users_not_found).
 */
export const resolveSlackIdByEmail = async (
  email: string,
): Promise<string | null> => {
  const token = readSlackToken();
  if (!token) {
    console.warn(NO_TOKEN_WARNING);
    return null;
  }

  try {
    const client = await createSlackClient(token);
    const res = await client.users.lookupByEmail({ email });
    return res.user?.id ?? null;
  } catch (error) {
    console.warn(LOOKUP_FAILED_WARNING, error);
    return null;
  }
};
