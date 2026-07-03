/**
 * Node-runtime Auth.js v5 wiring.
 *
 * This module owns the DB-touching auth callbacks (`signIn`, `jwt`, `session`)
 * and the server-side helpers (`getCurrentPlayer`, `requireAuth`). It is the
 * Node counterpart to the edge-safe `auth.config.ts`: it spreads that base
 * config and adds the callbacks that consult the roster.
 *
 * The roster source (`@/lib/services`) and `next/headers` / `next/navigation`
 * are imported DYNAMICALLY inside the functions that need them. This keeps
 * Prisma/Node-only code out of any import graph that the Edge middleware bundle
 * could reach, and matches the pattern already used in `lib/authz.ts`.
 */

import NextAuth from "next-auth";
import { resolveSignIn } from "@/lib/authPolicy";
import { DEV_PLAYER_COOKIE, resolveDevPlayerId } from "@/lib/devActor";
import authConfig from "@/auth.config";
import type { Player } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** NODE_ENV value that disables the local dev-actor fallback. */
const PRODUCTION_ENV = "production";

/** Auth.js sign-in route to redirect to when authentication is required. */
const SIGN_IN_PATH = "/api/auth/signin";

// ---------------------------------------------------------------------------
// Roster helper (Node-only, dynamically imported service)
// ---------------------------------------------------------------------------

/**
 * Reads the current roster from the selected service. Dynamic import defers
 * `@/lib/services` (and thus Prisma) resolution to call-time, keeping it out of
 * the edge bundle and consistent with `lib/authz.ts`.
 */
const loadRoster = async (): Promise<Player[]> => {
  const { gameService } = await import("@/lib/services");
  return gameService.listRoster();
};

// ---------------------------------------------------------------------------
// NextAuth instance
// ---------------------------------------------------------------------------

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  callbacks: {
    ...authConfig.callbacks,

    // -----------------------------------------------------------------------
    // signIn: gate on domain + active roster membership.
    // -----------------------------------------------------------------------
    async signIn({ user }) {
      const decision = resolveSignIn(user.email, await loadRoster());
      return decision.allowed;
    },

    // -----------------------------------------------------------------------
    // jwt: enrich the token with playerId/isAdmin from the roster.
    // -----------------------------------------------------------------------
    async jwt({ token }) {
      if (token.email) {
        const decision = resolveSignIn(token.email, await loadRoster());
        // Always (re)assign — never leave STALE privileges on the token. If the
        // player was deactivated/removed/demoted since sign-in, clear the fields
        // so the edge `authorized` gate (which trusts the token) revokes access.
        token.playerId = decision.allowed ? decision.player.id : undefined;
        token.isAdmin = decision.allowed ? decision.player.isAdmin : false;
      }
      return token;
    },

    // NOTE: the `session` callback is defined in `auth.config.ts` (shared with
    // the edge middleware) and inherited here via `...authConfig.callbacks`.
  },
});

// ---------------------------------------------------------------------------
// Server helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the current request's actor to a roster `Player`, or `null`.
 *
 * - With a real session email: re-resolves against the live roster (domain +
 *   active membership) and returns that player, or `null` if not allowed.
 * - Without a session, in non-production only: falls back to the dev-actor
 *   cookie (`DEV_PLAYER_COOKIE`) → `resolveDevPlayerId`, returning that player
 *   (or `roster[0]`); `null` when the roster is empty.
 * - Otherwise (production, no session): `null`.
 */
export async function getCurrentPlayer(): Promise<Player | null> {
  const session = await auth();
  const email = session?.user?.email;

  if (email) {
    const decision = resolveSignIn(email, await loadRoster());
    return decision.allowed ? decision.player : null;
  }

  if (process.env.NODE_ENV !== PRODUCTION_ENV) {
    const roster = await loadRoster();
    if (roster.length === 0) {
      return null;
    }
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const cookieValue = cookieStore.get(DEV_PLAYER_COOKIE)?.value;
    const playerId = resolveDevPlayerId(cookieValue, roster);
    return roster.find((p) => p.id === playerId) ?? null;
  }

  return null;
}

/**
 * Like `getCurrentPlayer` but redirects unauthenticated callers to the Auth.js
 * sign-in page instead of returning `null`. Guarantees a non-null `Player`.
 */
export async function requireAuth(): Promise<Player> {
  const player = await getCurrentPlayer();
  if (!player) {
    const { redirect } = await import("next/navigation");
    // `redirect` throws (returns `never`); the explicit throw documents that
    // control never falls through to the return below for the dynamic-import case.
    redirect(SIGN_IN_PATH);
    throw new Error("unreachable: redirect did not halt execution");
  }
  return player;
}
