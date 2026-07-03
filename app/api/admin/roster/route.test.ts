import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Player } from "@/lib/types";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const ADMIN_PLAYER_ID = "player-admin";
const NON_ADMIN_PLAYER_ID = "player-ada";
const ROUTE_URL = "http://localhost/api/admin/roster";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;

// Raw, unparseable body — deliberately NOT JSON.stringify-ed so request.json()
// throws. Regression for the parse happening outside the try/catch.
const MALFORMED_BODY = "{ this is not valid json";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makePlayer = (overrides: Partial<Player> = {}): Player => ({
  id: "player-1",
  name: "Alice",
  email: "alice@example.com",
  slackUserId: "U001",
  isAdmin: false,
  active: true,
  ...overrides,
});

const ROSTER_PLAYERS: Player[] = [
  makePlayer({ id: "player-1", name: "Alice" }),
  makePlayer({ id: "player-2", name: "Bob" }),
];

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const listRoster = vi.fn();
const upsertPlayer = vi.fn();
const deactivatePlayer = vi.fn();
const backfillSlackIds = vi.fn();

vi.mock("@/lib/use-cases/getDevActor", () => ({
  getDevActor: vi.fn(async () => ({
    players: [],
    currentPlayerId: ADMIN_PLAYER_ID,
    currentPlayer: { id: ADMIN_PLAYER_ID, isAdmin: true },
  })),
}));

vi.mock("@/lib/services", () => ({
  gameService: {
    listRoster: (...args: unknown[]) => listRoster(...args),
    upsertPlayer: (...args: unknown[]) => upsertPlayer(...args),
    deactivatePlayer: (...args: unknown[]) => deactivatePlayer(...args),
    backfillSlackIds: (...args: unknown[]) => backfillSlackIds(...args),
  },
}));

vi.mock("@/lib/authz", () => ({
  requireAdmin: vi.fn(),
  ForbiddenError: class ForbiddenError extends Error {
    readonly status = 403;
    constructor(message: string) {
      super(message);
      this.name = "ForbiddenError";
    }
  },
}));

// Imported AFTER the mocks are registered.
import { GET, POST } from "@/app/api/admin/roster/route";
import { getDevActor } from "@/lib/use-cases/getDevActor";
import { requireAdmin, ForbiddenError } from "@/lib/authz";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getRequest = (): Request =>
  new Request(ROUTE_URL, { method: "GET" });

const postRequest = (body: unknown): Request =>
  new Request(ROUTE_URL, {
    method: "POST",
    body: JSON.stringify(body),
  });

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  listRoster.mockReset();
  upsertPlayer.mockReset();
  deactivatePlayer.mockReset();
  backfillSlackIds.mockReset();
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(getDevActor).mockReset();

  // Default: admin actor, requireAdmin succeeds, service returns roster.
  vi.mocked(getDevActor).mockResolvedValue({
    players: [],
    currentPlayerId: ADMIN_PLAYER_ID,
    currentPlayer: { id: ADMIN_PLAYER_ID, isAdmin: true, name: "Admin", email: "admin@getklar.com", active: true },
  });
  vi.mocked(requireAdmin).mockReturnValue({
    id: ADMIN_PLAYER_ID,
    name: "Admin",
    email: "admin@getklar.com",
    isAdmin: true,
    active: true,
  });
  listRoster.mockResolvedValue(ROSTER_PLAYERS);
  upsertPlayer.mockResolvedValue(ROSTER_PLAYERS);
  deactivatePlayer.mockResolvedValue(ROSTER_PLAYERS);
  backfillSlackIds.mockResolvedValue({ updated: 0 });
});

// ---------------------------------------------------------------------------
// GET — non-admin 403 + service NOT called
// ---------------------------------------------------------------------------

describe("GET /api/admin/roster: non-admin actor", () => {
  beforeEach(() => {
    vi.mocked(getDevActor).mockResolvedValue({
      players: [],
      currentPlayerId: NON_ADMIN_PLAYER_ID,
      currentPlayer: { id: NON_ADMIN_PLAYER_ID, isAdmin: false, name: "Ada", email: "ada@getklar.com", active: true },
    });
    vi.mocked(requireAdmin).mockImplementation(() => {
      throw new ForbiddenError(`Player "${NON_ADMIN_PLAYER_ID}" does not have admin privileges.`);
    });
  });

  it("returns 403 with an error string", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(HTTP_FORBIDDEN);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
  });

  it("does NOT call listRoster when requireAdmin throws ForbiddenError", async () => {
    await GET(getRequest());

    expect(listRoster).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET — admin actor returns 200 { players }
// ---------------------------------------------------------------------------

describe("GET /api/admin/roster: admin actor", () => {
  it("returns 200 with { players } forwarded verbatim from listRoster", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(HTTP_OK);
    const json = await response.json();
    expect(json.players).toEqual(ROSTER_PLAYERS);
  });

  it("calls listRoster exactly once", async () => {
    await GET(getRequest());

    expect(listRoster).toHaveBeenCalledTimes(1);
  });

  it("calls requireAdmin with the resolved currentPlayerId", async () => {
    await GET(getRequest());

    expect(requireAdmin).toHaveBeenCalledTimes(1);
    expect(requireAdmin).toHaveBeenCalledWith(ADMIN_PLAYER_ID);
  });
});

// ---------------------------------------------------------------------------
// POST — non-admin 403 + service NOT called
// ---------------------------------------------------------------------------

describe("POST /api/admin/roster: non-admin actor", () => {
  beforeEach(() => {
    vi.mocked(getDevActor).mockResolvedValue({
      players: [],
      currentPlayerId: NON_ADMIN_PLAYER_ID,
      currentPlayer: { id: NON_ADMIN_PLAYER_ID, isAdmin: false, name: "Ada", email: "ada@getklar.com", active: true },
    });
    vi.mocked(requireAdmin).mockImplementation(() => {
      throw new ForbiddenError(`Player "${NON_ADMIN_PLAYER_ID}" does not have admin privileges.`);
    });
  });

  it("returns 403 with an error string", async () => {
    const response = await POST(
      postRequest({ action: "upsert", player: makePlayer() }),
    );

    expect(response.status).toBe(HTTP_FORBIDDEN);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
  });

  it("does NOT call upsertPlayer or deactivatePlayer when requireAdmin throws ForbiddenError", async () => {
    await POST(postRequest({ action: "upsert", player: makePlayer() }));

    expect(upsertPlayer).not.toHaveBeenCalled();
    expect(deactivatePlayer).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST — malformed body (regression)
// ---------------------------------------------------------------------------

describe("POST /api/admin/roster: malformed body", () => {
  it("returns 400 and does not call any service method when the body is not valid JSON", async () => {
    const response = await POST(
      new Request(ROUTE_URL, { method: "POST", body: MALFORMED_BODY }),
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(upsertPlayer).not.toHaveBeenCalled();
    expect(deactivatePlayer).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST — action "upsert" → 200 + { players }
// ---------------------------------------------------------------------------

describe("POST /api/admin/roster: action upsert", () => {
  it("calls upsertPlayer with the provided player and returns 200 with { players }", async () => {
    const player = makePlayer({ name: "Charlie", email: "charlie@example.com" });
    const response = await POST(postRequest({ action: "upsert", player }));

    expect(upsertPlayer).toHaveBeenCalledTimes(1);
    expect(upsertPlayer).toHaveBeenCalledWith(player);
    expect(deactivatePlayer).not.toHaveBeenCalled();

    expect(response.status).toBe(HTTP_OK);
    const json = await response.json();
    expect(json.players).toEqual(ROSTER_PLAYERS);
  });
});

// ---------------------------------------------------------------------------
// POST — action "deactivate" → 200 + { players }
// ---------------------------------------------------------------------------

describe("POST /api/admin/roster: action deactivate", () => {
  it("calls deactivatePlayer with the provided playerId and returns 200 with { players }", async () => {
    const playerId = "player-1";
    const response = await POST(postRequest({ action: "deactivate", playerId }));

    expect(deactivatePlayer).toHaveBeenCalledTimes(1);
    expect(deactivatePlayer).toHaveBeenCalledWith(playerId);
    expect(upsertPlayer).not.toHaveBeenCalled();

    expect(response.status).toBe(HTTP_OK);
    const json = await response.json();
    expect(json.players).toEqual(ROSTER_PLAYERS);
  });
});

// ---------------------------------------------------------------------------
// POST — unknown/missing action → 400, no service call
// ---------------------------------------------------------------------------

describe("POST /api/admin/roster: unknown or missing action", () => {
  it("returns 400 and does not call any service method when action is unrecognised", async () => {
    const response = await POST(
      postRequest({ action: "delete", playerId: "player-1" }),
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(upsertPlayer).not.toHaveBeenCalled();
    expect(deactivatePlayer).not.toHaveBeenCalled();
  });

  it("returns 400 when the action field is missing", async () => {
    const response = await POST(
      postRequest({ playerId: "player-1" }),
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(upsertPlayer).not.toHaveBeenCalled();
    expect(deactivatePlayer).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST — service rejection → 400 with thrown message
// ---------------------------------------------------------------------------

describe("POST /api/admin/roster: service error", () => {
  it("returns 400 with the error message when upsertPlayer rejects", async () => {
    upsertPlayer.mockRejectedValue(new Error("Player data is invalid."));

    const response = await POST(
      postRequest({ action: "upsert", player: makePlayer() }),
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(json.error).toBe("Player data is invalid.");
  });

  it("returns 400 with the error message when deactivatePlayer rejects", async () => {
    deactivatePlayer.mockRejectedValue(
      new Error(`Cannot deactivate: player with id "player-99" does not exist.`),
    );

    const response = await POST(
      postRequest({ action: "deactivate", playerId: "player-99" }),
    );

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(json.error).toBe(`Cannot deactivate: player with id "player-99" does not exist.`);
  });
});

// ---------------------------------------------------------------------------
// POST — action "resolve_slack" → backfill then return refreshed roster
// ---------------------------------------------------------------------------
//
// CONTRACT (intended new POST action on /api/admin/roster):
//   { action: "resolve_slack" }
//     → admin-only; calls gameService.backfillSlackIds() then
//       gameService.listRoster() and returns 200 { players } (the refreshed
//       roster). Non-admin → 403 with backfill NOT called. A service rejection
//       maps to 400 with the thrown message (mirrors upsert/deactivate).
// ---------------------------------------------------------------------------

describe("POST /api/admin/roster: action resolve_slack", () => {
  it("calls backfillSlackIds then listRoster and returns 200 with the refreshed { players }", async () => {
    const response = await POST(postRequest({ action: "resolve_slack" }));

    expect(backfillSlackIds).toHaveBeenCalledTimes(1);
    expect(listRoster).toHaveBeenCalledTimes(1);
    // The play-data mutators must not run on a slack-resolve.
    expect(upsertPlayer).not.toHaveBeenCalled();
    expect(deactivatePlayer).not.toHaveBeenCalled();

    expect(response.status).toBe(HTTP_OK);
    const json = await response.json();
    expect(json.players).toEqual(ROSTER_PLAYERS);
  });
});

describe("POST /api/admin/roster: action resolve_slack — non-admin actor", () => {
  beforeEach(() => {
    vi.mocked(getDevActor).mockResolvedValue({
      players: [],
      currentPlayerId: NON_ADMIN_PLAYER_ID,
      currentPlayer: { id: NON_ADMIN_PLAYER_ID, isAdmin: false, name: "Ada", email: "ada@getklar.com", active: true },
    });
    vi.mocked(requireAdmin).mockImplementation(() => {
      throw new ForbiddenError(`Player "${NON_ADMIN_PLAYER_ID}" does not have admin privileges.`);
    });
  });

  it("returns 403 and does NOT call backfillSlackIds when requireAdmin throws ForbiddenError", async () => {
    const response = await POST(postRequest({ action: "resolve_slack" }));

    expect(response.status).toBe(HTTP_FORBIDDEN);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(backfillSlackIds).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/roster: action resolve_slack — service error", () => {
  it("returns 400 with the error message when backfillSlackIds rejects", async () => {
    backfillSlackIds.mockRejectedValue(new Error("Slack backfill failed."));

    const response = await POST(postRequest({ action: "resolve_slack" }));

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    const json = await response.json();
    expect(json.error).toBe("Slack backfill failed.");
  });
});
