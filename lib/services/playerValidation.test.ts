import { describe, it, expect } from "vitest";
import { validatePlayerInput } from "@/lib/services/playerValidation";
import type { Player } from "@/lib/types";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Returns a fully-valid Player.  Individual tests override fields via
 * Partial<Player> to exercise each validation rule in isolation.
 */
const makePlayer = (overrides: Partial<Player> = {}): Player => ({
  id: "player-uuid-001",
  name: "Alice Example",
  email: "alice@example.com",
  isAdmin: false,
  active: true,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Constants — no magic literals
// ---------------------------------------------------------------------------

/** Strings that are empty or consist entirely of whitespace. */
const EMPTY_STRING = "";
const WHITESPACE_ONLY = "   ";
const TABS_ONLY = "\t\t";

/** Malformed email values that must be rejected. */
const EMAIL_NO_AT = "nope";
const EMAIL_MISSING_DOMAIN = "a@";
const EMAIL_MISSING_LOCAL = "@b";
const EMAIL_ONLY_AT = "@";

/** A minimal valid email — satisfies the x@y shape rule. */
const EMAIL_MINIMAL_VALID = "a@b";

// ---------------------------------------------------------------------------
// validatePlayerInput: valid player → does not throw
// ---------------------------------------------------------------------------

describe("validatePlayerInput: valid player — no throw", () => {
  it("does not throw for a fully-populated valid player", () => {
    expect(() => validatePlayerInput(makePlayer())).not.toThrow();
  });

  it("does not throw for a player with a minimal valid email (x@y shape)", () => {
    expect(() =>
      validatePlayerInput(makePlayer({ email: EMAIL_MINIMAL_VALID })),
    ).not.toThrow();
  });

  it("does not throw for a player with an optional slackUserId present", () => {
    expect(() =>
      validatePlayerInput(makePlayer({ slackUserId: "U0123456789" })),
    ).not.toThrow();
  });

  it("does not throw for a player with isAdmin true", () => {
    expect(() =>
      validatePlayerInput(makePlayer({ isAdmin: true })),
    ).not.toThrow();
  });

  it("does not throw for a player with active false", () => {
    expect(() =>
      validatePlayerInput(makePlayer({ active: false })),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validatePlayerInput: invalid id
// ---------------------------------------------------------------------------

describe("validatePlayerInput: invalid id — throws", () => {
  it("throws when id is an empty string", () => {
    expect(() =>
      validatePlayerInput(makePlayer({ id: EMPTY_STRING })),
    ).toThrow();
  });

  it("throws when id is whitespace-only", () => {
    expect(() =>
      validatePlayerInput(makePlayer({ id: WHITESPACE_ONLY })),
    ).toThrow();
  });

  it("throws an Error (not a non-Error thrown value) for blank id", () => {
    let caught: unknown;
    try {
      validatePlayerInput(makePlayer({ id: EMPTY_STRING }));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
  });

  it("error message for blank id is non-empty and descriptive", () => {
    let message = "";
    try {
      validatePlayerInput(makePlayer({ id: EMPTY_STRING }));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// validatePlayerInput: invalid name
// ---------------------------------------------------------------------------

describe("validatePlayerInput: invalid name — throws", () => {
  it("throws when name is an empty string", () => {
    expect(() =>
      validatePlayerInput(makePlayer({ name: EMPTY_STRING })),
    ).toThrow();
  });

  it("throws when name is whitespace-only", () => {
    expect(() =>
      validatePlayerInput(makePlayer({ name: WHITESPACE_ONLY })),
    ).toThrow();
  });

  it("throws when name is tabs-only", () => {
    expect(() =>
      validatePlayerInput(makePlayer({ name: TABS_ONLY })),
    ).toThrow();
  });

  it("throws an Error (not a non-Error thrown value) for blank name", () => {
    let caught: unknown;
    try {
      validatePlayerInput(makePlayer({ name: EMPTY_STRING }));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// validatePlayerInput: invalid email — blank
// ---------------------------------------------------------------------------

describe("validatePlayerInput: invalid email (blank) — throws", () => {
  it("throws when email is an empty string", () => {
    expect(() =>
      validatePlayerInput(makePlayer({ email: EMPTY_STRING })),
    ).toThrow();
  });

  it("throws when email is whitespace-only", () => {
    expect(() =>
      validatePlayerInput(makePlayer({ email: WHITESPACE_ONLY })),
    ).toThrow();
  });

  it("throws an Error (not a non-Error thrown value) for blank email", () => {
    let caught: unknown;
    try {
      validatePlayerInput(makePlayer({ email: EMPTY_STRING }));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// validatePlayerInput: invalid email — malformed (fails x@y shape check)
// ---------------------------------------------------------------------------

describe("validatePlayerInput: invalid email (malformed) — throws", () => {
  it("throws for an email with no '@' character ('nope')", () => {
    // Must contain '@' with non-empty local and domain parts.
    expect(() =>
      validatePlayerInput(makePlayer({ email: EMAIL_NO_AT })),
    ).toThrow();
  });

  it("throws for an email with a missing domain part ('a@')", () => {
    // '@' present but nothing after it → domain part is empty.
    expect(() =>
      validatePlayerInput(makePlayer({ email: EMAIL_MISSING_DOMAIN })),
    ).toThrow();
  });

  it("throws for an email with a missing local part ('@b')", () => {
    // '@' present but nothing before it → local part is empty.
    expect(() =>
      validatePlayerInput(makePlayer({ email: EMAIL_MISSING_LOCAL })),
    ).toThrow();
  });

  it("throws for a bare '@' with no local or domain part", () => {
    expect(() =>
      validatePlayerInput(makePlayer({ email: EMAIL_ONLY_AT })),
    ).toThrow();
  });

  it("error message for a malformed email is non-empty and descriptive", () => {
    let message = "";
    try {
      validatePlayerInput(makePlayer({ email: EMAIL_NO_AT }));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// validatePlayerInput: each invalid field throws independently
// ---------------------------------------------------------------------------

describe("validatePlayerInput: each field is validated independently", () => {
  it("a player with valid id/email but blank name still throws", () => {
    // Guard: the validator does not short-circuit after checking id only.
    expect(() =>
      validatePlayerInput(
        makePlayer({ id: "valid-id", email: "ok@ok.com", name: EMPTY_STRING }),
      ),
    ).toThrow();
  });

  it("a player with valid id/name but malformed email still throws", () => {
    expect(() =>
      validatePlayerInput(
        makePlayer({
          id: "valid-id",
          name: "Valid Name",
          email: EMAIL_MISSING_DOMAIN,
        }),
      ),
    ).toThrow();
  });

  it("a player with blank id but otherwise valid fields still throws", () => {
    expect(() =>
      validatePlayerInput(
        makePlayer({
          id: WHITESPACE_ONLY,
          name: "Valid Name",
          email: "ok@domain.com",
        }),
      ),
    ).toThrow();
  });
});
