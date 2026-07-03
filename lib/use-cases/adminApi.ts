/**
 * Shared admin-route helpers (use-cases layer).
 *
 * Provides the HTTP constants, error message constants, and the `requireAdminActor` /
 * `mapAdminError` helpers that are identical across all three admin week routes.
 * Extracting them here satisfies the CLAUDE.md DRY rule ("repeated >2x must be
 * extracted") without moving the mock boundaries that the route tests rely on —
 * `getDevActor` and `requireAdmin`/`ForbiddenError` are still imported from their
 * own modules, so existing `vi.mock(…)` calls in the test suite continue to
 * intercept them correctly.
 */

import { getDevActor } from "@/lib/use-cases/getDevActor";
import { requireAdmin, ForbiddenError } from "@/lib/authz";

// ---------------------------------------------------------------------------
// HTTP status constants (shared across all admin routes)
// ---------------------------------------------------------------------------

export const HTTP_OK = 200;
export const HTTP_BAD_REQUEST = 400;
export const HTTP_FORBIDDEN = 403;

// ---------------------------------------------------------------------------
// Shared error-message constants
// ---------------------------------------------------------------------------

/** Returned to the caller when the request body cannot be parsed as JSON. */
export const MALFORMED_BODY_MESSAGE = "Request body must be valid JSON.";

// ---------------------------------------------------------------------------
// Authorization helper
// ---------------------------------------------------------------------------

/**
 * Resolves the dev actor and enforces the admin privilege in one step.
 *
 * Returns a discriminated union:
 * - `{ ok: true; playerId: string }` — the caller is an admin; proceed.
 * - `{ ok: false; response: Response }` — auth failed; return the 403 response
 *   immediately (no further processing should occur).
 *
 * The helper calls `getDevActor` (mock-interceptable) and `requireAdmin` /
 * `ForbiddenError` (mock-interceptable) so route tests that `vi.mock` those
 * modules see the same code paths as in production.
 */
export async function requireAdminActor(): Promise<
  { ok: true; playerId: string } | { ok: false; response: Response }
> {
  const { currentPlayerId } = await getDevActor();

  try {
    await requireAdmin(currentPlayerId);
    return { ok: true, playerId: currentPlayerId };
  } catch (err) {
    if (
      err instanceof ForbiddenError ||
      (err as { status?: number }).status === HTTP_FORBIDDEN
    ) {
      const message = err instanceof Error ? err.message : "Forbidden.";
      return {
        ok: false,
        response: Response.json({ error: message }, { status: HTTP_FORBIDDEN }),
      };
    }
    // Non-auth errors from requireAdmin fall through as 400.
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return {
      ok: false,
      response: Response.json(
        { error: message },
        { status: HTTP_BAD_REQUEST },
      ),
    };
  }
}

// ---------------------------------------------------------------------------
// Service-error mapper
// ---------------------------------------------------------------------------

/**
 * Maps a caught service error to a 400 Response with the thrown message.
 * Used after body parsing and service delegation so callers avoid repeating
 * the same `catch (err)` pattern in every route handler.
 */
export function mapAdminError(err: unknown): Response {
  const message = err instanceof Error ? err.message : "Service error.";
  return Response.json({ error: message }, { status: HTTP_BAD_REQUEST });
}
