/**
 * Season windowing — pure UTC quarter math (slice 14).
 *
 * A "season" spans one calendar quarter (three months). This module derives the
 * NEXT quarter window after a given season end and decides whether a season has
 * expired, using only UTC calendar-day arithmetic — no Prisma, no timezones, no
 * time-of-day. All boundaries are exact UTC midnight so they round-trip cleanly
 * to Prisma `@db.Date` columns.
 *
 * Kept dependency-free (pure functions) so it is trivially unit-testable and can
 * be reused by both the rollover job and any UI that previews the next season.
 */

// ===========================================================================
// Constants
// ===========================================================================

/** A quarter spans three calendar months. */
export const QUARTER_MONTHS = 3;

/** Day-of-month sentinel that yields the LAST day of the previous month. */
const LAST_DAY_OF_PREVIOUS_MONTH = 0;

/** First calendar day of a month. */
const FIRST_DAY_OF_MONTH = 1;

/** Quarter numbers are 1-based (Q1..Q4). */
const FIRST_QUARTER_NUMBER = 1;

// ===========================================================================
// Types
// ===========================================================================

export type SeasonWindow = { name: string; startsOn: Date; endsOn: Date };

// ===========================================================================
// nextQuarterAfter — the quarter STRICTLY AFTER the one containing `endsOn`
// ===========================================================================

/**
 * Given a season end date, returns the window for the quarter that immediately
 * follows the quarter CONTAINING `endsOn` (in UTC).
 *
 *   startsOn = first UTC calendar day of the next quarter (midnight)
 *   endsOn   = last  UTC calendar day of the next quarter (midnight)
 *   name     = `${year} Q${n}` where n is 1..4
 *
 * `Date.UTC` handles month/year overflow, so a Q4 end rolls into next year's Q1.
 */
export const nextQuarterAfter = (endsOn: Date): SeasonWindow => {
  const year = endsOn.getUTCFullYear();
  const month = endsOn.getUTCMonth();

  // Start month of the quarter CONTAINING endsOn, then step to the NEXT quarter.
  const containingQuarterStartMonth =
    Math.floor(month / QUARTER_MONTHS) * QUARTER_MONTHS;
  const nextQuarterStartMonth = containingQuarterStartMonth + QUARTER_MONTHS;

  const startsOn = new Date(
    Date.UTC(year, nextQuarterStartMonth, FIRST_DAY_OF_MONTH),
  );

  // Last day of the next quarter = day 0 of the month AFTER the quarter.
  const endsOnDate = new Date(
    Date.UTC(
      year,
      nextQuarterStartMonth + QUARTER_MONTHS,
      LAST_DAY_OF_PREVIOUS_MONTH,
    ),
  );

  const quarterNumber =
    Math.floor(startsOn.getUTCMonth() / QUARTER_MONTHS) + FIRST_QUARTER_NUMBER;
  const name = `${startsOn.getUTCFullYear()} Q${quarterNumber}`;

  return { name, startsOn, endsOn: endsOnDate };
};

// ===========================================================================
// isSeasonExpired — UTC calendar-day comparison (same day = still in season)
// ===========================================================================

/** UTC calendar-day value (time-of-day stripped) for comparison. */
const utcDayValue = (date: Date): number =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

/**
 * True IFF today's UTC calendar day is STRICTLY AFTER endsOn's UTC calendar day.
 * The last day of the season is inclusive (same day → not expired).
 */
export const isSeasonExpired = (today: Date, endsOn: Date): boolean =>
  utcDayValue(today) > utcDayValue(endsOn);
