/**
 * Tests for lib/authz.ts — authorization guard.
 *
 * NEW CONTRACT (after fix):
 *   - `ForbiddenError`: a class that extends Error, exported from @/lib/authz,
 *     with a `status` property equal to HTTP_FORBIDDEN (403). Unchanged.
 *   - `requireAdmin(playerId: string): Promise<Player>`: ASYNC. Awaits
 *     `gameService.listRoster()` from `@/lib/services`, finds the player by id,
 *     returns the Player when found AND isAdmin === true, otherwise throws
 *     ForbiddenError (status 403).
 *
 * These tests are RED against the current SYNC implementation that reads
 * getMockStore().players — both because the async `.rejects` pattern is used
 * and because the mock of `@/lib/services` is not what the impl consults.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAdmin, ForbiddenError } from "@/lib/authz";
import type { Player } from "@/lib/types";

// ---------------------------------------------------------------------------
// Mocks — replace getMockStore-based roster with gameService.listRoster()
// ---------------------------------------------------------------------------

const listRoster = vi.fn<() => Promise<Player[]>>();
vi.mock("@/lib/services", () => ({
  gameService: { listRoster },
}));

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

/** HTTP 403 Forbidden status code. */
const HTTP_FORBIDDEN = 403;

// ---------------------------------------------------------------------------
// DB-style uuid roster (not fixture ids)
// The admin player uses a uuid so the test proves the impl reads the SERVICE
// roster rather than the hard-coded mock store.
// ---------------------------------------------------------------------------

const ADMIN_UUID = "db-uuid-admin-001";
const NON_ADMIN_UUID = "db-uuid-user-002";
const ANOTHER_NON_ADMIN_UUID = "db-uuid-user-003";
const UNKNOWN_UUID = "db-uuid-nobody-999";

const SERVICE_ROSTER: Player[] = [
  { id: ADMIN_UUID,          name: "Admin Alice", email: "alice@example.com", isAdmin: true,  active: true },
  { id: NON_ADMIN_UUID,      name: "Bob Normal",  email: "bob@example.com",   isAdmin: false, active: true },
  { id: ANOTHER_NON_ADMIN_UUID, name: "Carol User", email: "carol@example.com", isAdmin: false, active: true },
];

// ---------------------------------------------------------------------------
// ForbiddenError class contract — synchronous, unchanged
// ---------------------------------------------------------------------------

describe("authz: ForbiddenError class", () => {
  it("is a subclass of Error", () => {
    const error = new ForbiddenError("test");
    expect(error).toBeInstanceOf(Error);
  });

  it("is an instance of ForbiddenError", () => {
    const error = new ForbiddenError("test");
    expect(error).toBeInstanceOf(ForbiddenError);
  });

  it(`carries status === ${HTTP_FORBIDDEN}`, () => {
    const error = new ForbiddenError("test");
    expect(error.status).toBe(HTTP_FORBIDDEN);
  });

  it("exposes the message passed to the constructor", () => {
    const message = "Access denied";
    const error = new ForbiddenError(message);
    expect(error.message).toBe(message);
  });
});

// ---------------------------------------------------------------------------
// requireAdmin — now ASYNC, sources from gameService.listRoster()
// ---------------------------------------------------------------------------

describe("authz: requireAdmin — admin player (async, service-backed)", () => {
  beforeEach(() => {
    listRoster.mockReset();
    listRoster.mockResolvedValue(SERVICE_ROSTER);
  });

  // Happy path: known admin uuid in the service roster → resolves to that Player.
  it("resolves to the Player object for the admin player id", async () => {
    const player = await requireAdmin(ADMIN_UUID);
    expect(player).toBeDefined();
    expect(player.id).toBe(ADMIN_UUID);
  });

  it("resolved player has isAdmin === true", async () => {
    const player = await requireAdmin(ADMIN_UUID);
    expect(player.isAdmin).toBe(true);
  });

  it("resolved player carries a full Player shape (id, name, email, isAdmin, active)", async () => {
    const player = await requireAdmin(ADMIN_UUID);
    expect(typeof player.id).toBe("string");
    expect(typeof player.name).toBe("string");
    expect(typeof player.email).toBe("string");
    expect(typeof player.isAdmin).toBe("boolean");
    expect(typeof player.active).toBe("boolean");
  });

  // Contract: listRoster must be awaited once per call.
  it("calls gameService.listRoster() exactly once", async () => {
    await requireAdmin(ADMIN_UUID);
    expect(listRoster).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// requireAdmin — non-admin player → rejects with ForbiddenError 403
// ---------------------------------------------------------------------------

describe("authz: requireAdmin — non-admin player (async, service-backed)", () => {
  beforeEach(() => {
    listRoster.mockReset();
    listRoster.mockResolvedValue(SERVICE_ROSTER);
  });

  it("rejects for a non-admin player id", async () => {
    await expect(requireAdmin(NON_ADMIN_UUID)).rejects.toThrow();
  });

  it("rejects with a ForbiddenError instance for a non-admin player", async () => {
    await expect(requireAdmin(NON_ADMIN_UUID)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it(`rejects with status === ${HTTP_FORBIDDEN} for a non-admin player`, async () => {
    await expect(requireAdmin(NON_ADMIN_UUID)).rejects.toMatchObject({
      status: HTTP_FORBIDDEN,
    });
  });

  it("the rejection is both instanceof ForbiddenError and instanceof Error", async () => {
    let caught: unknown;
    try {
      await requireAdmin(NON_ADMIN_UUID);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ForbiddenError);
    expect(caught).toBeInstanceOf(Error);
  });

  it("rejects with ForbiddenError for a second non-admin player", async () => {
    await expect(requireAdmin(ANOTHER_NON_ADMIN_UUID)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it(`status is ${HTTP_FORBIDDEN} for the second non-admin player`, async () => {
    await expect(requireAdmin(ANOTHER_NON_ADMIN_UUID)).rejects.toMatchObject({
      status: HTTP_FORBIDDEN,
    });
  });
});

// ---------------------------------------------------------------------------
// requireAdmin — unknown id → rejects with ForbiddenError 403
// ---------------------------------------------------------------------------

describe("authz: requireAdmin — unknown player id (async, service-backed)", () => {
  beforeEach(() => {
    listRoster.mockReset();
    listRoster.mockResolvedValue(SERVICE_ROSTER);
  });

  it("rejects for an unknown player id", async () => {
    await expect(requireAdmin(UNKNOWN_UUID)).rejects.toThrow();
  });

  it("rejects with a ForbiddenError instance for an unknown player id", async () => {
    await expect(requireAdmin(UNKNOWN_UUID)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it(`rejects with status === ${HTTP_FORBIDDEN} for an unknown player id`, async () => {
    await expect(requireAdmin(UNKNOWN_UUID)).rejects.toMatchObject({
      status: HTTP_FORBIDDEN,
    });
  });

  it("the rejection is both instanceof ForbiddenError and instanceof Error", async () => {
    let caught: unknown;
    try {
      await requireAdmin(UNKNOWN_UUID);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ForbiddenError);
    expect(caught).toBeInstanceOf(Error);
  });
});
