import { describe, it, expect } from "vitest";
import { shouldUseMock } from "@/lib/services/selectService";

// ---------------------------------------------------------------------------
// Constants — no magic literals
// ---------------------------------------------------------------------------

/** The flag value that opts into the real DB (disables mock). */
const FLAG_FALSE_LOWERCASE = "false";
const FLAG_FALSE_UPPERCASE = "FALSE";
const FLAG_FALSE_MIXED = "False";

/** Non-"false" string values that should all resolve to mock = true. */
const FLAG_TRUE_EXPLICIT = "true";
const FLAG_EMPTY_STRING = "";
const FLAG_ZERO = "0";
const FLAG_MOCK_LITERAL = "mock";
const FLAG_ONE = "1";

// ---------------------------------------------------------------------------
// shouldUseMock: default behaviour (undefined)
// ---------------------------------------------------------------------------

describe("shouldUseMock: undefined flag → default to mock", () => {
  it("returns true when the flag is undefined (safe default: use mock)", () => {
    // Contract: the app uses the MOCK unless explicitly opted out.
    // An unset env var arrives as undefined → mock is on.
    expect(shouldUseMock(undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldUseMock: opting into the DB (flag = "false", case-insensitive)
// ---------------------------------------------------------------------------

describe("shouldUseMock: 'false' (case-insensitive) → DB mode", () => {
  it("returns false for lowercase 'false'", () => {
    expect(shouldUseMock(FLAG_FALSE_LOWERCASE)).toBe(false);
  });

  it("returns false for uppercase 'FALSE'", () => {
    expect(shouldUseMock(FLAG_FALSE_UPPERCASE)).toBe(false);
  });

  it("returns false for mixed-case 'False'", () => {
    expect(shouldUseMock(FLAG_FALSE_MIXED)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldUseMock: any non-"false" string → mock mode
// ---------------------------------------------------------------------------

describe("shouldUseMock: non-'false' strings → mock mode", () => {
  it("returns true for the string 'true'", () => {
    // Explicit opt-in to mock — redundant but valid.
    expect(shouldUseMock(FLAG_TRUE_EXPLICIT)).toBe(true);
  });

  it("returns true for an empty string ''", () => {
    // Empty string is NOT 'false', so mock stays on.
    expect(shouldUseMock(FLAG_EMPTY_STRING)).toBe(true);
  });

  it("returns true for '0' (not the word 'false')", () => {
    expect(shouldUseMock(FLAG_ZERO)).toBe(true);
  });

  it("returns true for 'mock'", () => {
    expect(shouldUseMock(FLAG_MOCK_LITERAL)).toBe(true);
  });

  it("returns true for '1'", () => {
    expect(shouldUseMock(FLAG_ONE)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldUseMock: return type is always boolean
// ---------------------------------------------------------------------------

describe("shouldUseMock: always returns a boolean", () => {
  it("returns a boolean for undefined input", () => {
    expect(typeof shouldUseMock(undefined)).toBe("boolean");
  });

  it("returns a boolean for 'false' input", () => {
    expect(typeof shouldUseMock(FLAG_FALSE_LOWERCASE)).toBe("boolean");
  });

  it("returns a boolean for a non-false string input", () => {
    expect(typeof shouldUseMock(FLAG_TRUE_EXPLICIT)).toBe("boolean");
  });
});
