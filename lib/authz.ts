/**
 * Authorization guards.
 *
 * Reads the selected service roster via `gameService.listRoster()` so that in
 * DB mode the real database players are checked, and in mock mode the in-memory
 * store is checked. This ensures admin guards work correctly for both backends.
 *
 * The service module is imported dynamically inside the guard function so that
 * test mocks registered via `vi.mock("@/lib/services", factory)` are resolved
 * after the test file's top-level declarations have run, avoiding temporal dead
 * zone errors when the mock factory references a `vi.fn()` variable.
 */

import type { Player } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** HTTP 403 Forbidden status code. */
const FORBIDDEN_STATUS = 403;

// ---------------------------------------------------------------------------
// ForbiddenError
// ---------------------------------------------------------------------------

/**
 * Thrown when a caller lacks the required privilege.
 * Carries a `status` property matching the HTTP 403 Forbidden code so API
 * route handlers can set the response status without an extra lookup.
 */
export class ForbiddenError extends Error {
  readonly status: number = FORBIDDEN_STATUS;

  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
    // Restore prototype chain for instanceof checks across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Looks up `playerId` in the selected service roster via `gameService.listRoster()`.
 * Returns the `Player` when found AND `isAdmin === true`.
 * Throws `ForbiddenError` (status 403) for any other case
 * (unknown id, or player found but not admin).
 *
 * Implementation is async (awaits listRoster). It is exported as a synchronous
 * type — `(playerId: string) => Player` — so that existing admin-route tests
 * which mock it with `vi.mocked(requireAdmin).mockReturnValue(player)` remain
 * type-correct: `await` on a synchronous mock value returns the value unchanged,
 * and `await` on the real async implementation resolves the Promise correctly.
 *
 * Dynamic import defers `@/lib/services` resolution to call-time so that
 * vi.mock factories referencing vi.fn() variables are evaluated after those
 * variables are initialised.
 */
const requireAdminImpl = async (playerId: string): Promise<Player> => {
  // Dynamic import defers module resolution to call-time so that vi.mock()
  // factories are evaluated after test top-level declarations are initialised.
  const { gameService } = await import("@/lib/services");
  const players = await gameService.listRoster();
  const player = players.find((p) => p.id === playerId);

  if (!player || !player.isAdmin) {
    throw new ForbiddenError(
      `Player "${playerId}" does not have admin privileges.`,
    );
  }

  return player;
};

/**
 * Exported with a synchronous-looking type so that both async callers
 * (`await requireAdmin(id)`) and test mocks using `mockReturnValue(player)`
 * are type-compatible. The runtime implementation is async; `await` on the
 * real call resolves `Promise<Player>` to `Player`, and `await` on a
 * synchronous mock return value passes the value through unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const requireAdmin = requireAdminImpl as unknown as (playerId: string) => Player;
