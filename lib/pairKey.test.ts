import { describe, it, expect } from "vitest";
import { makePairKey } from "@/lib/pairKey";

// ---------------------------------------------------------------------------
// Constants — no magic literals
// ---------------------------------------------------------------------------

/** The separator character used in the canonical pair-key format. */
const SEPARATOR = ":";

// ---------------------------------------------------------------------------
// Builders / helpers
// ---------------------------------------------------------------------------

/**
 * Produces the expected canonical key by sorting two ids lexicographically
 * and joining them with SEPARATOR.  Used in tests as an independent reference
 * so assertions do not hard-code the separator in multiple places.
 */
const expectedKey = (a: string, b: string): string =>
  [a, b].sort().join(SEPARATOR);

// ---------------------------------------------------------------------------
// makePairKey: canonical form
// ---------------------------------------------------------------------------

describe("makePairKey: canonical form", () => {
  it("returns '<lowerPlayerId>:<higherPlayerId>' for lexicographic order input", () => {
    // "p1" < "p2" lexicographically, so the key is "p1:p2".
    expect(makePairKey("p1", "p2")).toBe(`p1${SEPARATOR}p2`);
  });

  it("uses the SEPARATOR constant — result contains exactly one colon", () => {
    const key = makePairKey("p1", "p2");
    const colonCount = key.split("").filter((ch) => ch === SEPARATOR).length;
    expect(colonCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// makePairKey: order independence
// ---------------------------------------------------------------------------

describe("makePairKey: order independence", () => {
  it("returns the same key regardless of argument order (p1, p2) vs (p2, p1)", () => {
    expect(makePairKey("p1", "p2")).toBe(makePairKey("p2", "p1"));
  });

  it("sorts lexicographically so (z, a) and (a, z) both produce 'a:z'", () => {
    const EXPECTED = `a${SEPARATOR}z`;
    expect(makePairKey("z", "a")).toBe(EXPECTED);
    expect(makePairKey("a", "z")).toBe(EXPECTED);
  });

  it("handles longer ids where string sort differs from insertion order", () => {
    // "player-beta" < "player-zeta" lexicographically.
    const key1 = makePairKey("player-zeta", "player-beta");
    const key2 = makePairKey("player-beta", "player-zeta");
    expect(key1).toBe(key2);
    expect(key1).toBe(`player-beta${SEPARATOR}player-zeta`);
  });
});

// ---------------------------------------------------------------------------
// makePairKey: distinct pairs produce distinct keys
// ---------------------------------------------------------------------------

describe("makePairKey: distinct pairs produce distinct keys", () => {
  it("different unordered pairs yield different keys", () => {
    const keyAB = makePairKey("p1", "p2");
    const keyAC = makePairKey("p1", "p3");
    const keyBC = makePairKey("p2", "p3");

    expect(keyAB).not.toBe(keyAC);
    expect(keyAB).not.toBe(keyBC);
    expect(keyAC).not.toBe(keyBC);
  });

  it("is deterministic — repeated calls with the same args return the same key", () => {
    const first = makePairKey("p4", "p7");
    const second = makePairKey("p4", "p7");
    const third = makePairKey("p7", "p4");

    expect(first).toBe(second);
    expect(first).toBe(third);
  });
});

// ---------------------------------------------------------------------------
// makePairKey: edge case — equal ids
// ---------------------------------------------------------------------------

describe("makePairKey: edge case — equal ids", () => {
  it("does not throw when both ids are identical", () => {
    expect(() => makePairKey("x", "x")).not.toThrow();
  });

  it("returns '<id>:<id>' (self-pair) when both ids are equal", () => {
    // Same id on both sides shouldn't happen in practice (a player cannot face
    // themselves) but the function must be total and produce a defined result.
    const SELF_ID = "x";
    expect(makePairKey(SELF_ID, SELF_ID)).toBe(
      `${SELF_ID}${SEPARATOR}${SELF_ID}`,
    );
  });
});

// ---------------------------------------------------------------------------
// makePairKey: purity (inputs are not mutated)
// ---------------------------------------------------------------------------

describe("makePairKey: purity — inputs are not mutated", () => {
  it("returns a string (the canonical key) and leaves string inputs unchanged", () => {
    // Strings are immutable in JS, but we verify the return shape explicitly
    // and confirm the original bindings still hold their values.
    const idA = "player-alpha";
    const idB = "player-beta";

    const result = makePairKey(idA, idB);

    // Return value is a non-empty string.
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);

    // Original variables are unchanged.
    expect(idA).toBe("player-alpha");
    expect(idB).toBe("player-beta");
  });

  it("result matches the independently computed expected key (reference check)", () => {
    expect(makePairKey("zz-99", "aa-01")).toBe(expectedKey("zz-99", "aa-01"));
    expect(makePairKey("aa-01", "zz-99")).toBe(expectedKey("aa-01", "zz-99"));
  });
});
