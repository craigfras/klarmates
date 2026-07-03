/**
 * pairKey — canonical unordered-pair key utility.
 *
 * Produces a stable, order-independent string key for any pair of player IDs.
 * The key backs the `@@unique([seasonId, pairKey])` Prisma constraint that
 * enforces the in-season no-repeat guard: each unordered pair of players can
 * only meet once per season.
 *
 * Contract:
 *   - Total: always returns a string, even for equal IDs ("x:x").
 *   - Order-independent: makePairKey(a, b) === makePairKey(b, a).
 *   - Deterministic: same inputs always produce the same output.
 *   - No I/O, no side effects.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The delimiter between the two player IDs in a canonical pair key. */
const SEPARATOR = ":";

// ---------------------------------------------------------------------------
// makePairKey
// ---------------------------------------------------------------------------

/**
 * Returns the canonical key for an unordered pair of player IDs.
 *
 * The smaller ID (lexicographic order) is always placed first so the key is
 * identical regardless of which player is passed as `a` vs `b`.
 */
export const makePairKey = (a: string, b: string): string =>
  a <= b ? `${a}${SEPARATOR}${b}` : `${b}${SEPARATOR}${a}`;
