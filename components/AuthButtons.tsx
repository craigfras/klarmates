"use client";

/**
 * AuthButtons — production sign-in / sign-out control (Auth.js v5).
 *
 * Rendered by the Nav in production (the dev-actor switcher takes its place
 * locally). When a player is signed in it shows their name + a Sign out button;
 * otherwise a "Sign in with Google" button. All session work is delegated to
 * next-auth/react — this view carries no auth logic.
 */

import { signIn, signOut } from "next-auth/react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOOGLE_PROVIDER = "google";
const SIGN_IN_LABEL = "Sign in with Google";
const SIGN_OUT_LABEL = "Sign out";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type AuthButtonsProps = {
  /** The signed-in player's display name, or null/undefined when signed out. */
  name?: string | null;
};

export function AuthButtons({ name }: AuthButtonsProps) {
  if (!name) {
    return (
      <button
        type="button"
        className="nav-auth-btn"
        onClick={() => signIn(GOOGLE_PROVIDER)}
      >
        {SIGN_IN_LABEL}
      </button>
    );
  }

  return (
    <div className="nav-auth">
      <span className="nav-user mono">{name}</span>
      <button type="button" className="nav-auth-btn" onClick={() => signOut()}>
        {SIGN_OUT_LABEL}
      </button>
    </div>
  );
}
