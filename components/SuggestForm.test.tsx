/**
 * SuggestForm — the /suggest page's client form (question-suggestions slice 1).
 *
 * ============================================================
 * CONTRACT DECISIONS (code-writer must match exactly)
 * ============================================================
 *
 * Mirrors components/AnswerForm.tsx. Renders a single text input + a submit
 * button, and POSTs to `/api/suggestions` with a JSON body `{ text }`.
 *
 *   - On a successful submit (fetch ok): shows a "Thanks — submitted"
 *     confirmation and offers a reset / "add another" control so the player can
 *     submit again. (Copy is matched case-insensitively / by substring; the
 *     endpoint + method + body shape are pinned.)
 *   - On failure (fetch not ok, or fetch rejects): surfaces an error via
 *     `role="alert"`.
 *
 * The endpoint, HTTP method, and body shape below are load-bearing and pinned;
 * exact confirmation/error copy is matched loosely.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SuggestForm } from "@/components/SuggestForm";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUGGESTIONS_ENDPOINT = "/api/suggestions";
const THANKS_PATTERN = /thanks/i;
const ADD_ANOTHER_PATTERN = /add another/i;
const TYPED_TEXT = "What song describes your week?";
const NETWORK_ERROR_MESSAGE = "network down";

// ---------------------------------------------------------------------------
// Fetch fakes
// ---------------------------------------------------------------------------

const mockFetch = (impl: () => Promise<unknown>) => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<unknown>>(
    impl,
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

// A fetch that REJECTS (simulates a network failure), as opposed to resolving
// with { ok: false }.
const mockRejectingFetch = (error: Error) => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<unknown>>(
    () => Promise.reject(error),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

describe("SuggestForm: rendering", () => {
  it("renders a text input and a submit button", () => {
    mockFetch(async () => ({ ok: true, json: async () => ({}) }));
    render(<SuggestForm />);

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// successful submit
// ---------------------------------------------------------------------------

describe("SuggestForm: successful submit", () => {
  it("POSTs { text } to /api/suggestions", async () => {
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    const user = userEvent.setup();
    render(<SuggestForm />);

    await user.type(screen.getByRole("textbox"), TYPED_TEXT);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(SUGGESTIONS_ENDPOINT);
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.text).toBe(TYPED_TEXT);
  });

  it("shows a 'Thanks — submitted' confirmation and an 'add another' control", async () => {
    mockFetch(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    const user = userEvent.setup();
    render(<SuggestForm />);

    await user.type(screen.getByRole("textbox"), TYPED_TEXT);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText(THANKS_PATTERN)).toBeInTheDocument();
    });

    // A reset / "add another" control is offered so the player can submit again.
    expect(
      screen.getByRole("button", { name: ADD_ANOTHER_PATTERN }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// failed submit
// ---------------------------------------------------------------------------

describe("SuggestForm: failed submit", () => {
  it("surfaces an error via role=alert when the response is not ok", async () => {
    mockFetch(async () => ({ ok: false, json: async () => ({}) }));
    const user = userEvent.setup();
    render(<SuggestForm />);

    await user.type(screen.getByRole("textbox"), TYPED_TEXT);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  it("surfaces an error via role=alert when fetch rejects (network failure)", async () => {
    mockRejectingFetch(new Error(NETWORK_ERROR_MESSAGE));
    const user = userEvent.setup();
    render(<SuggestForm />);

    await user.type(screen.getByRole("textbox"), TYPED_TEXT);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });
});
