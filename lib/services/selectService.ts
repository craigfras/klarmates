/**
 * selectService — data-source selection helpers.
 *
 * Determines whether the application should use the in-memory mock store or
 * the real database, based on the value of an environment flag string.
 *
 * Default-safe design: anything other than the literal word "false"
 * (case-insensitive) keeps the mock ON.  An unset, empty, or misspelled
 * USE_MOCK env var therefore never silently routes traffic to the real DB.
 *
 * No I/O, no side effects — pure functions only.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The exact sentinel value (lowercased) that opts the app into real-DB mode. */
const DB_MODE_SENTINEL = "false";

// ---------------------------------------------------------------------------
// shouldUseMock
// ---------------------------------------------------------------------------

/**
 * Returns `true` (use mock) unless the flag is the literal string "false"
 * (any casing).  `undefined` and any other non-"false" value all keep the
 * mock active.
 */
export const shouldUseMock = (flag: string | undefined): boolean =>
  (flag ?? "").trim().toLowerCase() !== DB_MODE_SENTINEL;
