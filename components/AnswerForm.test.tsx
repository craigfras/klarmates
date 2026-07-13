import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnswerForm } from "@/components/AnswerForm";
import { ToastProvider, ToastViewport } from "@/components/Toast";
import { loadAnswerDraft, saveAnswerDraft } from "@/lib/services/answerDraftStore";
import type { MyWeekView, Player, Question } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEEK_ID = "week-2026-25";
const ANSWERS_ENDPOINT = "/api/me/answers";
const SPINNER_TEST_ID = "spinner";
const SUCCESS_TOAST_PATTERN = /submitted/i;
const ERROR_VARIANT = "error";
const NETWORK_ERROR_MESSAGE = "network down";

// A draft already persisted before the form mounts (hydration source).
const SAVED_DRAFT: Record<string, string> = {
  q0: "restored answer 0",
  q1: "restored answer 1",
  q2: "restored answer 2",
  q3: "restored answer 3",
};

// The map that typeAllAnswers produces, mirrored for draft assertions.
const TYPED_DRAFT: Record<string, string> = {
  q0: "answer 0",
  q1: "answer 1",
  q2: "answer 2",
  q3: "answer 3",
};

const EMPTY_DRAFT: Record<string, string> = {};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

const makePlayer = (overrides: Partial<Player> = {}): Player => ({
  id: "player-opp",
  name: "Opponent Name",
  email: "opp@getklar.com",
  isAdmin: false,
  active: true,
  ...overrides,
});

const FOUR_QUESTIONS: Question[] = [
  { id: "q0", orderIndex: 0, text: "First question text?" },
  { id: "q1", orderIndex: 1, text: "Second question text?" },
  { id: "q2", orderIndex: 2, text: "Third question text?" },
  { id: "q3", orderIndex: 3, text: "Fourth question text?" },
];

const makeView = (overrides: Partial<MyWeekView> = {}): MyWeekView => ({
  weekId: WEEK_ID,
  startsAt: "2026-06-22T00:00:00.000Z",
  status: "open",
  opponent: makePlayer(),
  isBye: false,
  questions: FOUR_QUESTIONS,
  myAnswersSubmitted: false,
  opponentAnswered: false,
  guessingUnlocked: false,
  guessingComplete: false,
  myCorrectGuesses: 0,
  ...overrides,
});

const mockFetch = (impl: () => Promise<unknown>) => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<unknown>>(
    impl,
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

// A fetch that REJECTS (simulates a network failure / aborted request), as
// opposed to resolving with { ok: false }. Used by the rejection regression.
const mockRejectingFetch = (error: Error) => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<unknown>>(
    () => Promise.reject(error),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

// Renders the form inside the toast context so success/error toasts can be
// asserted via role="status" (success) and the existing inline role="alert".
const renderWithToasts = (view: MyWeekView) =>
  render(
    <ToastProvider>
      <AnswerForm view={view} />
      <ToastViewport />
    </ToastProvider>,
  );

/**
 * A manually-resolvable fetch response. Lets a test assert the in-flight
 * spinner/disabled state BEFORE resolving, then resolve to observe the toast.
 */
type FetchResponse = { ok: boolean; json: () => Promise<unknown> };

const createDeferredFetch = (response: FetchResponse) => {
  let resolveFetch!: () => void;
  const pending = new Promise<void>((resolve) => {
    resolveFetch = resolve;
  });
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<FetchResponse>>(
    () => pending.then(() => response),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, resolve: resolveFetch };
};

const typeAllAnswers = async (user: ReturnType<typeof userEvent.setup>) => {
  for (let index = 0; index < FOUR_QUESTIONS.length; index += 1) {
    const input = screen.getByLabelText(FOUR_QUESTIONS[index].text);
    await user.type(input, `answer ${index}`);
  }
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  refresh.mockClear();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

describe("AnswerForm: rendering", () => {
  it("renders one labeled input per question plus a submit button", () => {
    mockFetch(async () => ({ ok: true, json: async () => ({}) }));
    render(<AnswerForm view={makeView()} />);

    for (const question of FOUR_QUESTIONS) {
      expect(screen.getByLabelText(question.text)).toBeInTheDocument();
    }
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// successful submit
// ---------------------------------------------------------------------------

describe("AnswerForm: successful submit", () => {
  it("POSTs all four answers, refreshes, and disables the form", async () => {
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({}),
    }));
    const user = userEvent.setup();
    render(<AnswerForm view={makeView()} />);

    await typeAllAnswers(user);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ANSWERS_ENDPOINT);
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.weekId).toBe(WEEK_ID);
    expect(body.answers).toHaveLength(FOUR_QUESTIONS.length);
    for (let index = 0; index < FOUR_QUESTIONS.length; index += 1) {
      expect(body.answers).toContainEqual({
        questionId: FOUR_QUESTIONS[index].id,
        text: `answer ${index}`,
      });
    }

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByRole("button")).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// failed submit
// ---------------------------------------------------------------------------

describe("AnswerForm: failed submit", () => {
  it("shows an error and re-enables the button when the response is not ok", async () => {
    mockFetch(async () => ({ ok: false, json: async () => ({}) }));
    const user = userEvent.setup();
    render(<AnswerForm view={makeView()} />);

    await typeAllAnswers(user);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(refresh).not.toHaveBeenCalled();
    });

    // An error message is surfaced to the player.
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // The button is re-enabled so they can retry.
    await waitFor(() => {
      expect(screen.getByRole("button")).not.toBeDisabled();
    });
  });
});

// ---------------------------------------------------------------------------
// spinner while in flight + success/error toasts (new UX feature)
// ---------------------------------------------------------------------------

describe("AnswerForm: in-flight spinner and toasts", () => {
  it("shows the submit button's spinner (aria-busy + disabled) while the POST is pending", async () => {
    const { resolve } = createDeferredFetch({ ok: true, json: async () => ({}) });
    const user = userEvent.setup();
    renderWithToasts(makeView());

    await typeAllAnswers(user);
    const submit = screen.getByRole("button", { name: /submit/i });
    await user.click(submit);

    // While pending: button busy + disabled + spinner present.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /submit/i })).toHaveAttribute(
        "aria-busy",
        "true",
      );
    });
    expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
    expect(screen.getByTestId(SPINNER_TEST_ID)).toBeInTheDocument();

    // Let the request finish.
    resolve();
  });

  it("raises a success toast on a successful submit", async () => {
    const { resolve } = createDeferredFetch({ ok: true, json: async () => ({}) });
    const user = userEvent.setup();
    renderWithToasts(makeView());

    await typeAllAnswers(user);
    await user.click(screen.getByRole("button", { name: /submit/i }));

    resolve();

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(SUCCESS_TOAST_PATTERN);
    });
    expect(screen.getByRole("status")).toHaveAttribute("data-variant", "success");
  });

  it("raises an error toast on failure (in addition to the inline role=alert)", async () => {
    const { resolve } = createDeferredFetch({ ok: false, json: async () => ({}) });
    const user = userEvent.setup();
    renderWithToasts(makeView());

    await typeAllAnswers(user);
    await user.click(screen.getByRole("button", { name: /submit/i }));

    resolve();

    // Inline error stays.
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    // And an error toast appears.
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveAttribute("data-variant", "error");
    });
  });
});

// ---------------------------------------------------------------------------
// fetch rejection regression (bug: button spins forever, no error surfaced)
// ---------------------------------------------------------------------------

describe("AnswerForm: fetch rejection regression", () => {
  /**
   * Regression for the bug where handleSubmit only handles { ok: false } HTTP
   * responses. When fetch itself REJECTS (network failure), the await throws
   * before setSubmitting(false) runs, so the submit button stays
   * disabled + aria-busy with its spinner forever, no error toast fires, and
   * the rejection goes unhandled. After the rejection settles the button must
   * be usable again and an error must be surfaced (toast + inline alert).
   */
  it("recovers the submit button when fetch rejects (network failure) instead of spinning forever (regression)", async () => {
    mockRejectingFetch(new Error(NETWORK_ERROR_MESSAGE));
    const user = userEvent.setup();
    renderWithToasts(makeView());

    await typeAllAnswers(user);
    await user.click(screen.getByRole("button", { name: /submit/i }));

    // After the rejection settles the button must NOT be stuck spinning:
    // not aria-busy, not disabled, and the spinner is gone (user can retry).
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /submit/i })).not.toHaveAttribute(
        "aria-busy",
        "true",
      );
    });
    expect(screen.getByRole("button", { name: /submit/i })).not.toBeDisabled();
    expect(screen.queryByTestId(SPINNER_TEST_ID)).not.toBeInTheDocument();
  });

  it("surfaces an error toast and the inline alert when fetch rejects (network failure) (regression)", async () => {
    mockRejectingFetch(new Error(NETWORK_ERROR_MESSAGE));
    const user = userEvent.setup();
    renderWithToasts(makeView());

    await typeAllAnswers(user);
    await user.click(screen.getByRole("button", { name: /submit/i }));

    // An error toast appears in the viewport region.
    const viewport = await screen.findByRole("region");
    await waitFor(() => {
      expect(within(viewport).getByRole("status")).toHaveAttribute(
        "data-variant",
        ERROR_VARIANT,
      );
    });

    // The existing inline error is also present.
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// draft auto-save: hydration from a saved draft
// ---------------------------------------------------------------------------

describe("AnswerForm: draft hydration", () => {
  it("pre-fills each input from the saved draft for view.weekId on mount", () => {
    mockFetch(async () => ({ ok: true, json: async () => ({}) }));
    saveAnswerDraft(WEEK_ID, SAVED_DRAFT);

    render(<AnswerForm view={makeView()} />);

    for (const question of FOUR_QUESTIONS) {
      expect(screen.getByLabelText(question.text)).toHaveValue(
        SAVED_DRAFT[question.id],
      );
    }
  });

  it("leaves inputs empty when no draft exists for view.weekId", () => {
    mockFetch(async () => ({ ok: true, json: async () => ({}) }));

    render(<AnswerForm view={makeView()} />);

    for (const question of FOUR_QUESTIONS) {
      expect(screen.getByLabelText(question.text)).toHaveValue("");
    }
  });
});

// ---------------------------------------------------------------------------
// draft auto-save: persistence while typing
// ---------------------------------------------------------------------------

describe("AnswerForm: draft auto-save", () => {
  it("persists the typed answers for view.weekId as the user types", async () => {
    mockFetch(async () => ({ ok: true, json: async () => ({}) }));
    const user = userEvent.setup();
    render(<AnswerForm view={makeView()} />);

    await typeAllAnswers(user);

    // Assert through the service so we don't couple to the storage key format.
    await waitFor(() => {
      expect(loadAnswerDraft(WEEK_ID)).toEqual(TYPED_DRAFT);
    });
  });

  it("restores typed text after an accidental unmount then remount", async () => {
    mockFetch(async () => ({ ok: true, json: async () => ({}) }));
    const user = userEvent.setup();
    const { unmount } = render(<AnswerForm view={makeView()} />);

    await typeAllAnswers(user);
    // The draft must have survived in storage before the tab "closes".
    await waitFor(() => {
      expect(loadAnswerDraft(WEEK_ID)).toEqual(TYPED_DRAFT);
    });

    unmount();
    render(<AnswerForm view={makeView()} />);

    for (const question of FOUR_QUESTIONS) {
      expect(screen.getByLabelText(question.text)).toHaveValue(
        TYPED_DRAFT[question.id],
      );
    }
  });
});

// ---------------------------------------------------------------------------
// draft auto-save: cleared on success, kept on failure
// ---------------------------------------------------------------------------

describe("AnswerForm: draft lifecycle around submit", () => {
  it("clears the draft for that week after a successful submit", async () => {
    mockFetch(async () => ({ ok: true, json: async () => ({}) }));
    const user = userEvent.setup();
    render(<AnswerForm view={makeView()} />);

    await typeAllAnswers(user);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(loadAnswerDraft(WEEK_ID)).toEqual(EMPTY_DRAFT);
    });
  });

  it("keeps the draft when the response is not ok (still recoverable)", async () => {
    mockFetch(async () => ({ ok: false, json: async () => ({}) }));
    const user = userEvent.setup();
    render(<AnswerForm view={makeView()} />);

    await typeAllAnswers(user);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    // Draft NOT cleared — the player can retry without retyping.
    expect(loadAnswerDraft(WEEK_ID)).toEqual(TYPED_DRAFT);
  });

  it("keeps the draft when fetch rejects (network failure)", async () => {
    mockRejectingFetch(new Error(NETWORK_ERROR_MESSAGE));
    const user = userEvent.setup();
    renderWithToasts(makeView());

    await typeAllAnswers(user);
    await user.click(screen.getByRole("button", { name: /submit/i }));

    // Wait until the rejection has settled and the button is usable again.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /submit/i })).not.toBeDisabled();
    });
    expect(loadAnswerDraft(WEEK_ID)).toEqual(TYPED_DRAFT);
  });
});
