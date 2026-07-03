/**
 * Auth.js v5 module augmentation.
 *
 * Extends the session `user` and the JWT with our domain fields (`playerId`,
 * `isAdmin`) so callbacks and consumers can read them without `as any` casts.
 * Picked up by the tsconfig "include" TypeScript glob.
 */

import { type DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      playerId?: string;
      isAdmin?: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    playerId?: string;
    isAdmin?: boolean;
  }
}

// `next-auth/jwt` re-exports `@auth/core/jwt` via `export *`, which does not
// declaration-merge across modules. The callbacks' `token` parameter is typed
// from `@auth/core/jwt`, so augment that module directly too.
declare module "@auth/core/jwt" {
  interface JWT {
    playerId?: string;
    isAdmin?: boolean;
  }
}
