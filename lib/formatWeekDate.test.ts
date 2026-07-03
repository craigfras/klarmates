/**
 * Tests for formatWeekDate — the shared week-start date formatter.
 *
 * CONTRACT DECISIONS (for code-writer):
 *
 *   formatWeekDate(iso: string): string
 *
 *   - A valid ISO 8601 string is formatted as "<Mon> <D>, <YYYY>" in en-US,
 *     pinned to UTC so the rendered day matches the ISO date regardless of the
 *     viewer's timezone (e.g. "2026-06-22T00:00:00.000Z" -> "Jun 22, 2026").
 *   - An empty string ("") -> "" (the cold-start no-week case). Never "Invalid
 *     Date".
 *   - An unparseable string ("not-a-date") -> "" (guarded). Never "Invalid Date".
 *
 *   This mirrors the format already used by MatchupCard's eyebrow and is the
 *   single shared implementation that MatchupCard, AdminMatchupList and
 *   AdminQuestionReview consume (CLAUDE.md DRY rule).
 */

import { describe, it, expect } from "vitest";
import { formatWeekDate } from "@/lib/formatWeekDate";

// ---------------------------------------------------------------------------
// Constants (no magic numbers / inline literals)
// ---------------------------------------------------------------------------

const VALID_ISO = "2026-06-22T00:00:00.000Z";
const EXPECTED_FORMATTED = "Jun 22, 2026";

const EMPTY_ISO = "";
const INVALID_ISO = "not-a-date";
const EMPTY_RESULT = "";

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("formatWeekDate: valid ISO", () => {
  it("formats a valid ISO start date as '<Mon> <D>, <YYYY>' in UTC", () => {
    expect(formatWeekDate(VALID_ISO)).toBe(EXPECTED_FORMATTED);
  });
});

// ---------------------------------------------------------------------------
// Edge / error cases
// ---------------------------------------------------------------------------

describe("formatWeekDate: empty and invalid input", () => {
  it("returns '' for an empty string (cold-start no-week case)", () => {
    expect(formatWeekDate(EMPTY_ISO)).toBe(EMPTY_RESULT);
  });

  it("returns '' for an unparseable string (never 'Invalid Date')", () => {
    expect(formatWeekDate(INVALID_ISO)).toBe(EMPTY_RESULT);
  });
});
