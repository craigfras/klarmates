/**
 * POST /api/suggestions — player suggests a question (slice 1).
 *
 * ============================================================
 * CONTRACT DECISIONS (code-writer must match exactly)
 * ============================================================
 *
 * Non-admin route (mirrors app/api/me/answers/route.ts). Resolves the current
 * dev actor via getDevActor() as the suggester — does NOT require
 * requireAdminActor.
 *
 *   - Valid body `{ text }` → 200 with `{ ok: true }`, and
 *     `gameService.suggestQuestion(currentPlayerId, text)` called once.
 *   - Malformed JSON body → 400, service NOT called.
 *   - Missing / non-string / empty-string `text` → 400 (route-level guard,
 *     pre-service), service NOT called.
 *   - Whitespace-only `text` (`"   "`) → route DELEGATES to the service; the
 *     service rejects (whitespace-only is a service-level rule) and the route
 *     maps that rejection to a 400 with the thrown message. i.e. the service
 *     IS called in this case.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const CURRENT_PLAYER_ID = "player-ada";
const ROUTE_URL = "http://localhost/api/suggestions";
const VALID_TEXT = "What is your favourite programming language?";
const WHITESPACE_TEXT = "   ";

// Raw, unparseable body — deliberately NOT JSON.stringify-ed so request.json()
// throws, mirroring the malformed-body regression on the answers route.
const MALFORMED_BODY = "{ this is not valid json";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const suggestQuestion = vi.fn();

vi.mock("@/lib/use-cases/getDevActor", () => ({
  getDevActor: vi.fn(async () => ({
    players: [],
    currentPlayerId: CURRENT_PLAYER_ID,
    currentPlayer: { id: CURRENT_PLAYER_ID },
  })),
}));

vi.mock("@/lib/services", () => ({
  gameService: {
    suggestQuestion: (...args: unknown[]) => suggestQuestion(...args),
  },
}));

// Imported AFTER the mocks are registered.
import { POST } from "@/app/api/suggestions/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const postRequest = (body: unknown): Request =>
  new Request(ROUTE_URL, {
    method: "POST",
    body: JSON.stringify(body),
  });

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  suggestQuestion.mockReset();
  suggestQuestion.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// happy path
// ---------------------------------------------------------------------------

describe("POST /api/suggestions: success", () => {
  it("calls suggestQuestion with (currentPlayerId, text) and returns { ok: true }", async () => {
    const response = await POST(postRequest({ text: VALID_TEXT }));

    expect(suggestQuestion).toHaveBeenCalledTimes(1);
    expect(suggestQuestion).toHaveBeenCalledWith(CURRENT_PLAYER_ID, VALID_TEXT);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// malformed body
// ---------------------------------------------------------------------------

describe("POST /api/suggestions: malformed body", () => {
  it("returns 400 and does not call suggestQuestion when the body is not valid JSON", async () => {
    const response = await POST(
      new Request(ROUTE_URL, { method: "POST", body: MALFORMED_BODY }),
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(suggestQuestion).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// route-level text guard (pre-service)
// ---------------------------------------------------------------------------

describe("POST /api/suggestions: text shape validation", () => {
  it("returns 400 and does not call suggestQuestion when text is missing", async () => {
    const response = await POST(postRequest({}));

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(suggestQuestion).not.toHaveBeenCalled();
  });

  it("returns 400 and does not call suggestQuestion when text is not a string", async () => {
    const response = await POST(postRequest({ text: 42 }));

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(suggestQuestion).not.toHaveBeenCalled();
  });

  it("returns 400 and does not call suggestQuestion when text is an empty string", async () => {
    const response = await POST(postRequest({ text: "" }));

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(typeof json.error).toBe("string");
    expect(suggestQuestion).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// whitespace-only text → delegated to the service, rejection mapped to 400
// ---------------------------------------------------------------------------

describe("POST /api/suggestions: whitespace-only text is a service rejection", () => {
  it("delegates to the service and maps its rejection to a 400 with the thrown message", async () => {
    suggestQuestion.mockRejectedValue(new Error("Suggestion text is required."));

    const response = await POST(postRequest({ text: WHITESPACE_TEXT }));

    // The route did NOT pre-empt this with its own guard — it delegated.
    expect(suggestQuestion).toHaveBeenCalledTimes(1);
    expect(suggestQuestion).toHaveBeenCalledWith(
      CURRENT_PLAYER_ID,
      WHITESPACE_TEXT,
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Suggestion text is required.");
  });
});
