/**
 * Edge middleware for route gating.
 *
 * Uses ONLY the edge-safe `auth.config.ts` (no Prisma / Node-only code). Gating
 * is driven by the `authorized` callback in that config: returning `false`
 * redirects to the sign-in page, a `Response` is used verbatim, `true` continues.
 *
 * IMPORTANT: we export the bare `auth` middleware (NOT `auth(handler)`). In
 * Auth.js v5 the `authorized` callback only runs in this handler-less form;
 * passing a handler makes that handler own the response and silently bypasses
 * `authorized` (which previously let every request through).
 */

import NextAuth from "next-auth";
import authConfig from "@/auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export default middleware;

// Run on everything except Next internals and static asset files (those with a
// dot in the final path segment, e.g. *.png, *.css, favicon.ico).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.).*)"],
};
