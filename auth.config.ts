/**
 * Edge-safe Auth.js v5 base configuration.
 *
 * This module is imported by BOTH `middleware.ts` (Edge runtime) and
 * `lib/auth.ts` (Node runtime). It must therefore stay free of any Node-only
 * dependency: NO `@/lib/services` / Prisma, NO `next/headers`, NO `next/navigation`.
 *
 * It declares the Google provider and the `authorized` route-gating callback,
 * which runs in middleware and may only read the already-issued JWT via
 * `auth.user` (enriched in the Node-side `jwt` callback in `lib/auth.ts`).
 */

import Google from "next-auth/providers/google";
import type { NextAuthConfig } from "next-auth";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Path prefix for Auth.js endpoints; always reachable so sign-in can work. */
const AUTH_API_PREFIX = "/api/auth";

/** Path prefix gated to admins only (pages; API admin routes self-enforce 403). */
const ADMIN_PREFIX = "/admin";

/** API path prefix — gets JSON status responses rather than HTML redirects. */
const API_PREFIX = "/api";

const HTTP_UNAUTHORIZED = 401;

/** NODE_ENV value that turns on real route gating. */
const PRODUCTION_ENV = "production";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export default {
  // Reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET lazily at request time.
  providers: [Google],
  session: { strategy: "jwt" },
  // Trust the deployment host when constructing callback URLs. Required for
  // self-hosted / `npm start` (non-Vercel) so Auth.js doesn't throw
  // UntrustedHost; on Vercel this is auto. Safe because the host is fixed by
  // our own deploy + NEXTAUTH_URL.
  trustHost: true,
  callbacks: {
    // -----------------------------------------------------------------------
    // Route gating (Edge): JWT-only, no DB access.
    // Returning `false` makes Auth.js redirect to the sign-in page.
    // -----------------------------------------------------------------------
    authorized({ auth, request }) {
      // In non-production, allow everything — local dev uses the dev-actor cookie.
      if (process.env.NODE_ENV !== PRODUCTION_ENV) {
        return true;
      }

      const path = request.nextUrl.pathname;

      // Auth endpoints must stay open so unauthenticated users can sign in.
      if (path.startsWith(AUTH_API_PREFIX)) {
        return true;
      }

      const isLoggedIn = !!auth?.user;
      if (!isLoggedIn) {
        // API callers get a clean JSON 401; page navigations get the Auth.js
        // sign-in redirect (returning false).
        if (path.startsWith(API_PREFIX)) {
          return Response.json({ error: "Unauthorized" }, { status: HTTP_UNAUTHORIZED });
        }
        return false;
      }

      // Admin PAGES are admins-only (API admin routes enforce their own 403 in
      // the handler via requireAdminActor). Send a signed-in non-admin home.
      if (path.startsWith(ADMIN_PREFIX) && auth.user.isAdmin !== true) {
        return Response.redirect(new URL("/", request.nextUrl));
      }

      return true;
    },

    // -----------------------------------------------------------------------
    // session: surface the token's domain fields on session.user.
    // Lives HERE (not just in lib/auth.ts) so the EDGE middleware instance also
    // populates `auth.user.playerId`/`isAdmin` — otherwise the /admin gate above
    // sees `isAdmin === undefined` and bounces real admins. Token-only, edge-safe.
    // -----------------------------------------------------------------------
    session({ session, token }) {
      if (session.user) {
        session.user.playerId = token.playerId;
        session.user.isAdmin = token.isAdmin;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
