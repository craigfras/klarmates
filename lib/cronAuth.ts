/**
 * Vercel Cron authorization guard (slice 13).
 *
 * Vercel Cron invokes the scheduled endpoints with an `Authorization: Bearer
 * <CRON_SECRET>` header. This guard rejects every request that does not carry
 * that exact bearer, and rejects ALL requests when no CRON_SECRET is configured
 * (fail-closed: an unset secret must never accidentally allow open access).
 *
 * Server-only: reads process.env at call time (not import time), so it never
 * captures a stale secret and stays test-friendly.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The scheme prefix Vercel Cron uses in the Authorization header. */
const BEARER_PREFIX = "Bearer ";

const AUTHORIZATION_HEADER = "authorization";

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/**
 * True IFF CRON_SECRET is set (non-empty) AND the request's Authorization
 * header equals `Bearer ${CRON_SECRET}`. False in every other case.
 */
export const isAuthorizedCron = (request: Request): boolean => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }
  return (
    request.headers.get(AUTHORIZATION_HEADER) === `${BEARER_PREFIX}${secret}`
  );
};
