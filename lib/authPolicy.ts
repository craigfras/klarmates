/**
 * Sign-in authorization policy — pure functions.
 *
 * Two concerns live here as pure TypeScript so they can be unit-tested in
 * isolation and reused by the auth/data layers. First, `isAllowedEmail` decides
 * whether an email is a well-formed `local@getklar.com` address. Second,
 * `resolveSignIn` combines that domain check with a roster lookup to decide
 * whether a given session email may sign in. No I/O, no side effects, no
 * mutation of inputs.
 */

import type { Player } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The only email domain permitted to sign in. */
export const ALLOWED_EMAIL_DOMAIN = "getklar.com";

/** The "@" separator between an email's local and domain parts. */
const AT_SEPARATOR = "@";

/** A valid email splits into exactly this many "@"-delimited parts. */
const EMAIL_PART_COUNT = 2;

/** Positions of the local and domain parts after splitting on "@". */
const LOCAL_PART_INDEX = 0;
const DOMAIN_PART_INDEX = 1;

/** Matches any whitespace, used to reject embedded spaces in the local part. */
const WHITESPACE_PATTERN = /\s/;

// ---------------------------------------------------------------------------
// Email validation
// ---------------------------------------------------------------------------

/**
 * True only for a well-formed `local@getklar.com` address: trims the input;
 * requires a single "@" with a non-empty, whitespace-free local part; the
 * domain must equal `ALLOWED_EMAIL_DOMAIN` case-insensitively. Everything else
 * (null/undefined/empty/whitespace, other domains, subdomain spoofs, missing
 * local part, multiple "@") is false.
 */
export const isAllowedEmail = (email: string | null | undefined): boolean => {
  if (email === null || email === undefined) {
    return false;
  }

  const trimmed = email.trim();
  if (trimmed.length === 0) {
    return false;
  }

  const parts = trimmed.split(AT_SEPARATOR);
  if (parts.length !== EMAIL_PART_COUNT) {
    return false;
  }

  const localPart = parts[LOCAL_PART_INDEX];
  const domainPart = parts[DOMAIN_PART_INDEX];

  if (localPart.length === 0 || WHITESPACE_PATTERN.test(localPart)) {
    return false;
  }

  return domainPart.toLowerCase() === ALLOWED_EMAIL_DOMAIN;
};

// ---------------------------------------------------------------------------
// Sign-in resolution
// ---------------------------------------------------------------------------

export type SignInDecision =
  | { allowed: true; player: Player }
  | { allowed: false; reason: "domain" | "not_on_roster" };

/**
 * Decides whether `email` may sign in given the current `roster`.
 *
 * - A disallowed-domain (or malformed/empty) email is rejected with reason
 *   "domain" and the roster is never consulted.
 * - Otherwise an active roster player whose email matches the trimmed input
 *   case-insensitively is required; none found → reason "not_on_roster".
 *
 * Pure: the roster is read-only and never mutated.
 */
export const resolveSignIn = (
  email: string | null | undefined,
  roster: Player[],
): SignInDecision => {
  if (!isAllowedEmail(email)) {
    return { allowed: false, reason: "domain" };
  }

  const normalizedEmail = (email as string).trim().toLowerCase();
  const player = roster.find(
    (candidate) =>
      candidate.active &&
      candidate.email.toLowerCase() === normalizedEmail,
  );

  if (player === undefined) {
    return { allowed: false, reason: "not_on_roster" };
  }

  return { allowed: true, player };
};
