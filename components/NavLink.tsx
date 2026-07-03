"use client";

/**
 * A single primary navigation link.
 *
 * Client component so it can read the active route from the pathname and mark
 * itself as the current page. `aria-current="page"` both drives assistive tech
 * and selects the active-link styling (the "selector" pill) in globals.css.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface NavLinkProps {
  href: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Active-route matching
// ---------------------------------------------------------------------------

/**
 * The home route only matches exactly; every other route also matches its
 * nested paths (e.g. /admin/roster keeps the Admin link active).
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NavLink({ href, label }: NavLinkProps) {
  const pathname = usePathname();
  const active = isActive(pathname, href);

  return (
    <Link
      className="nav-link"
      href={href}
      aria-current={active ? "page" : undefined}
    >
      {label}
    </Link>
  );
}
