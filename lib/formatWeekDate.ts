/**
 * formatWeekDate — the single shared week-start date formatter.
 *
 * A week's ISO start date is rendered as "<Mon> <D>, <YYYY>" in en-US, pinned to
 * UTC so the rendered day matches the ISO date regardless of the viewer's
 * timezone. Empty / unparseable input yields "" (never "Invalid Date"), covering
 * the cold-start no-week case. Pure and safe on both server and client; consumed
 * by MatchupCard, AdminMatchupList and AdminQuestionReview (CLAUDE.md DRY rule).
 */

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

const WEEK_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export const formatWeekDate = (iso: string): string => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return WEEK_DATE_FORMAT.format(date);
};
