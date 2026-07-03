/**
 * Tests for the Vercel Cron authorization guard (slice 13).
 *
 * CONTRACT (intended new export from "@/lib/cronAuth"):
 *   - isAuthorizedCron(request: Request): boolean
 *
 * Returns true IFF process.env.CRON_SECRET is set (non-empty) AND the request's
 * Authorization header equals `Bearer ${CRON_SECRET}` (the header Vercel Cron
 * sends). False in every other case (wrong bearer, missing header, unset secret).
 *
 * Pre-implementation, "@/lib/cronAuth" does not exist — the import fails to
 * resolve, so every test in this file fails for that reason until the module
 * is written.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isAuthorizedCron } from "@/lib/cronAuth";

// ---------------------------------------------------------------------------
// Constants (no magic values)
// ---------------------------------------------------------------------------

const CRON_SECRET = "test-secret";
const WRONG_SECRET = "not-the-secret";
const REQUEST_URL = "https://x/api/cron/draft-week";
const AUTHORIZATION_HEADER = "Authorization";

/** Builds the `Bearer <token>` header value Vercel Cron sends. */
const bearer = (token: string): string => `Bearer ${token}`;

/** Builds a real Request with the given headers (empty object → no headers). */
const requestWithHeaders = (headers: Record<string, string>): Request =>
  new Request(REQUEST_URL, { headers });

// ---------------------------------------------------------------------------
// Env setup — save + set CRON_SECRET, restore afterwards
// ---------------------------------------------------------------------------

let savedSecret: string | undefined;

beforeEach(() => {
  savedSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = CRON_SECRET;
});

afterEach(() => {
  if (savedSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = savedSecret;
  }
});

// ---------------------------------------------------------------------------
// Authorized — correct bearer matching CRON_SECRET
// ---------------------------------------------------------------------------

describe("cronAuth: isAuthorizedCron with a configured secret", () => {
  it("returns true when Authorization is `Bearer <CRON_SECRET>`", () => {
    const request = requestWithHeaders({
      [AUTHORIZATION_HEADER]: bearer(CRON_SECRET),
    });

    expect(isAuthorizedCron(request)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Wrong / missing bearer → false
  // -------------------------------------------------------------------------

  it("returns false when the bearer token does not match the secret", () => {
    const request = requestWithHeaders({
      [AUTHORIZATION_HEADER]: bearer(WRONG_SECRET),
    });

    expect(isAuthorizedCron(request)).toBe(false);
  });

  it("returns false when the Authorization header is missing", () => {
    const request = requestWithHeaders({});

    expect(isAuthorizedCron(request)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// No secret configured → false even with a valid-looking bearer
// ---------------------------------------------------------------------------

describe("cronAuth: isAuthorizedCron with no secret configured", () => {
  it("returns false when CRON_SECRET is unset, even with a Bearer header", () => {
    delete process.env.CRON_SECRET;
    const request = requestWithHeaders({
      [AUTHORIZATION_HEADER]: bearer(CRON_SECRET),
    });

    expect(isAuthorizedCron(request)).toBe(false);
  });
});
