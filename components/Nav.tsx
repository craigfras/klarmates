/**
 * Top navigation.
 *
 * Brand + primary routes. The dev "act as player" switcher is mounted here so it
 * is reachable from every screen, but only outside production. Leaderboard and
 * History routes arrive in later slices.
 */

import Link from "next/link";
import { getDevActor } from "@/lib/use-cases/getDevActor";
import { DevActorSwitcher } from "@/components/DevActorSwitcher";
import { AuthButtons } from "@/components/AuthButtons";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IS_DEV = process.env.NODE_ENV !== "production";

const PRIMARY_LINKS = [
  { href: "/", label: "Home", current: true },
  { href: "/leaderboard", label: "Leaderboard", current: false },
  { href: "/history", label: "History", current: false },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export async function Nav() {
  // Dev/test: identity via the dev-actor cookie (+ switcher). Production:
  // identity via the real Google session (+ sign in/out control).
  const devActor = IS_DEV ? await getDevActor() : null;
  const sessionPlayer = IS_DEV
    ? null
    : await (await import("@/lib/auth")).getCurrentPlayer();
  const currentPlayer = devActor?.currentPlayer ?? sessionPlayer;
  const isAdmin = currentPlayer?.isAdmin === true;

  return (
    <nav className="nav">
      {/* --- Brand --- */}
      <Link className="nav-brand" href="/">
        <span className="nav-brand-mark">Matchup</span>
        <span className="nav-brand-tag">Klar Eng</span>
      </Link>

      {/* --- Routes + dev tooling --- */}
      <div className="nav-links">
        {PRIMARY_LINKS.map((link) => (
          <Link
            key={link.href}
            className="nav-link"
            href={link.href}
            aria-current={link.current ? "page" : undefined}
          >
            {link.label}
          </Link>
        ))}
        {/* --- Admin link: visible only when the current player is an admin --- */}
        {isAdmin && (
          <Link className="nav-link" href="/admin">
            Admin
          </Link>
        )}
        {/* Local dev: impersonation switcher. Production: real sign in/out. */}
        {devActor ? (
          <DevActorSwitcher
            players={devActor.players}
            currentPlayerId={devActor.currentPlayerId}
          />
        ) : (
          <AuthButtons name={currentPlayer?.name} />
        )}
      </div>
    </nav>
  );
}
