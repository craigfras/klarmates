import { describe, it, expect } from "vitest";
import {
  ALLOWED_EMAIL_DOMAIN,
  isAllowedEmail,
  resolveSignIn,
  type SignInDecision,
} from "@/lib/authPolicy";
import type { Player } from "@/lib/types";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Returns a fully-valid active Player.  Individual tests override fields via
 * Partial<Player> to exercise each sign-in rule in isolation.
 */
const makePlayer = (id: string, overrides: Partial<Player> = {}): Player => ({
  id,
  name: `Name ${id}`,
  email: `${id}@${ALLOWED_EMAIL_DOMAIN}`,
  isAdmin: false,
  active: true,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Constants — no magic strings
// ---------------------------------------------------------------------------

/** A couple of active roster players plus one inactive player. */
const ACTIVE_ADA = makePlayer("ada", { email: `ada@${ALLOWED_EMAIL_DOMAIN}` });
const ACTIVE_CRAIG = makePlayer("craig", {
  email: `craig.f@${ALLOWED_EMAIL_DOMAIN}`,
});
const INACTIVE_GRACE = makePlayer("grace", {
  email: `grace@${ALLOWED_EMAIL_DOMAIN}`,
  active: false,
});

const ROSTER: Player[] = [ACTIVE_ADA, ACTIVE_CRAIG, INACTIVE_GRACE];

/** Allowed-domain email addresses (valid local@getklar.com shapes). */
const EMAIL_ADA_LOWER = `ada@${ALLOWED_EMAIL_DOMAIN}`;
const EMAIL_ADA_MIXED_CASE = "Ada@GetKlar.COM";
const EMAIL_CRAIG = `craig.f@${ALLOWED_EMAIL_DOMAIN}`;

/** Rejected email values. */
const EMAIL_EMPTY = "";
const EMAIL_WHITESPACE = "  ";
const EMAIL_NO_AT = "nope";
const EMAIL_OTHER_DOMAIN = "x@gmail.com";
const EMAIL_MISSING_LOCAL = `@${ALLOWED_EMAIL_DOMAIN}`;
const EMAIL_SUBDOMAIN_TRICK = `x@${ALLOWED_EMAIL_DOMAIN}.evil.com`;
const EMAIL_EMBEDDED_SPACE = `x y@${ALLOWED_EMAIL_DOMAIN}`;
const EMAIL_DOUBLE_AT = `a@b@${ALLOWED_EMAIL_DOMAIN}`;

// ---------------------------------------------------------------------------
// ALLOWED_EMAIL_DOMAIN constant
// ---------------------------------------------------------------------------

describe("authPolicy: ALLOWED_EMAIL_DOMAIN", () => {
  it("is the getklar.com domain", () => {
    expect(ALLOWED_EMAIL_DOMAIN).toBe("getklar.com");
  });
});

// ---------------------------------------------------------------------------
// isAllowedEmail: accepted addresses
// ---------------------------------------------------------------------------

describe("isAllowedEmail: accepted", () => {
  it("accepts a plain local@getklar.com address", () => {
    expect(isAllowedEmail(EMAIL_ADA_LOWER)).toBe(true);
  });

  it("accepts a mixed-case address case-insensitively", () => {
    expect(isAllowedEmail(EMAIL_ADA_MIXED_CASE)).toBe(true);
  });

  it("accepts a dotted local part (craig.f@getklar.com)", () => {
    expect(isAllowedEmail(EMAIL_CRAIG)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isAllowedEmail: rejected addresses
// ---------------------------------------------------------------------------

describe("isAllowedEmail: rejected", () => {
  it("rejects null", () => {
    expect(isAllowedEmail(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isAllowedEmail(undefined)).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isAllowedEmail(EMAIL_EMPTY)).toBe(false);
  });

  it("rejects a whitespace-only string", () => {
    expect(isAllowedEmail(EMAIL_WHITESPACE)).toBe(false);
  });

  it("rejects a string with no '@' ('nope')", () => {
    expect(isAllowedEmail(EMAIL_NO_AT)).toBe(false);
  });

  it("rejects a different domain (x@gmail.com)", () => {
    expect(isAllowedEmail(EMAIL_OTHER_DOMAIN)).toBe(false);
  });

  it("rejects a missing local part ('@getklar.com')", () => {
    expect(isAllowedEmail(EMAIL_MISSING_LOCAL)).toBe(false);
  });

  it("rejects a subdomain spoof (x@getklar.com.evil.com)", () => {
    expect(isAllowedEmail(EMAIL_SUBDOMAIN_TRICK)).toBe(false);
  });

  it("rejects an embedded space in the local part ('x y@getklar.com')", () => {
    expect(isAllowedEmail(EMAIL_EMBEDDED_SPACE)).toBe(false);
  });

  it("rejects more than one '@' (a@b@getklar.com)", () => {
    expect(isAllowedEmail(EMAIL_DOUBLE_AT)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveSignIn: allowed — matched to an active roster player
// ---------------------------------------------------------------------------

describe("resolveSignIn: allowed (active roster match)", () => {
  it("allows an active roster player and returns that player", () => {
    const decision = resolveSignIn(EMAIL_ADA_LOWER, ROSTER);

    expect(decision).toEqual({ allowed: true, player: ACTIVE_ADA });
  });

  it("matches the roster email case-insensitively (mixed-case session vs lowercased roster)", () => {
    // Session email arrives mixed-case; the roster stores it lowercased.
    const decision = resolveSignIn(EMAIL_ADA_MIXED_CASE, ROSTER);

    expect(decision.allowed).toBe(true);
    expect((decision as Extract<SignInDecision, { allowed: true }>).player).toBe(
      ACTIVE_ADA,
    );
  });
});

// ---------------------------------------------------------------------------
// resolveSignIn: not on roster
// ---------------------------------------------------------------------------

describe("resolveSignIn: not on roster", () => {
  it("rejects an allowed-domain email with no matching roster player", () => {
    const decision = resolveSignIn(`stranger@${ALLOWED_EMAIL_DOMAIN}`, ROSTER);

    expect(decision).toEqual({ allowed: false, reason: "not_on_roster" });
  });

  it("rejects an allowed-domain email matching an INACTIVE roster player", () => {
    // A matching player exists but active === false → treated as not on roster.
    const decision = resolveSignIn(INACTIVE_GRACE.email, ROSTER);

    expect(decision).toEqual({ allowed: false, reason: "not_on_roster" });
  });
});

// ---------------------------------------------------------------------------
// resolveSignIn: domain rejection (roster not consulted)
// ---------------------------------------------------------------------------

describe("resolveSignIn: domain rejection", () => {
  it("rejects a non-getklar.com email with reason 'domain'", () => {
    const decision = resolveSignIn(EMAIL_OTHER_DOMAIN, ROSTER);

    expect(decision).toEqual({ allowed: false, reason: "domain" });
  });

  it("rejects a non-getklar.com email even when its local part matches a roster name shape", () => {
    // A gmail address whose value collides with a roster entry must still be
    // domain-rejected — resolveSignIn never consults the roster for it.
    const gmailMatchingRoster = "ada@gmail.com";
    const rosterWithGmailEmail: Player[] = [
      makePlayer("ada", { email: gmailMatchingRoster }),
    ];

    const decision = resolveSignIn(gmailMatchingRoster, rosterWithGmailEmail);

    expect(decision).toEqual({ allowed: false, reason: "domain" });
  });

  it("rejects null with reason 'domain'", () => {
    expect(resolveSignIn(null, ROSTER)).toEqual({
      allowed: false,
      reason: "domain",
    });
  });

  it("rejects an empty email with reason 'domain'", () => {
    expect(resolveSignIn(EMAIL_EMPTY, ROSTER)).toEqual({
      allowed: false,
      reason: "domain",
    });
  });
});

// ---------------------------------------------------------------------------
// resolveSignIn: purity (no roster mutation)
// ---------------------------------------------------------------------------

describe("resolveSignIn: purity", () => {
  it("does not mutate the roster array (order or elements)", () => {
    const roster: Player[] = [
      makePlayer("ada", { email: EMAIL_ADA_LOWER }),
      makePlayer("craig", { email: EMAIL_CRAIG }),
      makePlayer("grace", { email: `grace@${ALLOWED_EMAIL_DOMAIN}`, active: false }),
    ];
    const snapshot = roster.map((player) => ({ ...player }));

    resolveSignIn(EMAIL_ADA_MIXED_CASE, roster);

    expect(roster).toEqual(snapshot);
    expect(roster.map((player) => player.id)).toEqual(["ada", "craig", "grace"]);
  });
});
