/**
 * AdminJobControls component tests (UX upgrade contract).
 *
 * ---------------------------------------------------------------------------
 * Contract decisions documented for the code-writer
 * ---------------------------------------------------------------------------
 * A "use client" console rendering FOUR job operations. Two are "safe" (POST
 * immediately on click); two are "destructive" (open a ConfirmDialog first and
 * POST only when the user confirms). Mirrors AdminQuestionReview conventions:
 * mocked global.fetch, mocked next/navigation useRouter, shared Toast provider.
 *
 * Trigger buttons (accessible names) → endpoints (all method POST, no body):
 *   - SAFE        "Draft next week"     → /api/admin/jobs/draft-week
 *   - SAFE        "Send reminders"      → /api/admin/jobs/reminder
 *   - DESTRUCTIVE "Close current week"  → /api/admin/jobs/close-week
 *   - DESTRUCTIVE "Roll over season"    → /api/admin/jobs/season-rollover
 *
 * Row scoping:
 *   Each operation renders inside a container with data-testid="job-<key>",
 *   keys: draft, reminder, close, rollover. The inline result string / error
 *   alert for an operation lives INSIDE that operation's row.
 *
 * Inline result summaries derived from each success response body (exact
 * substrings asserted inside the row after success):
 *   - draft-week   { questionCount: 4 } → "Drafted 4 questions"
 *   - reminder     { sent: 3 }          → "Reminded 3 players"
 *   - close-week   { closed: true }     → "Week closed and results sent"
 *                  { closed: false }    → "No open week to close"
 *   - rollover     { rolledOver: true } → "Season rolled over"
 *                  { rolledOver: false }→ "No current season to roll over"
 *
 * Destructive confirm dialog:
 *   Clicking a destructive trigger does NOT fetch — it opens a role="dialog"
 *   whose confirm button is named by the trigger label and which also has a
 *   "Cancel" button. The body copy warns the action can't be undone (asserted
 *   via /undone/i). POST fires only on Confirm. Escape / Cancel / backdrop all
 *   abort without fetching.
 *
 * Success handling mirrors postAndRefresh: router.refresh() once + success
 * toast. Non-ok { error } surfaces via role="alert" inside the row and does
 * NOT refresh. While a confirmed request is in flight the confirm button shows
 * the Button loading state (aria-busy="true" + one spinner).
 *
 * Pre-implementation the component still has the OLD immediate-POST behavior
 * (no dialog, no inline results, no data-testids, generic toast), so these
 * tests fail against the current implementation until it is rewritten.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminJobControls } from "@/components/AdminJobControls";
import { ToastProvider, ToastViewport } from "@/components/Toast";

// ---------------------------------------------------------------------------
// Constants — labels
// ---------------------------------------------------------------------------

const DRAFT_LABEL = "Draft next week";
const REMINDER_LABEL = "Send reminders";
const CLOSE_LABEL = "Close current week";
const ROLLOVER_LABEL = "Roll over season";

const CANCEL_LABEL = "Cancel";

// ---------------------------------------------------------------------------
// Constants — endpoints
// ---------------------------------------------------------------------------

const DRAFT_ENDPOINT = "/api/admin/jobs/draft-week";
const REMINDER_ENDPOINT = "/api/admin/jobs/reminder";
const CLOSE_ENDPOINT = "/api/admin/jobs/close-week";
const ROLLOVER_ENDPOINT = "/api/admin/jobs/season-rollover";

// ---------------------------------------------------------------------------
// Constants — row test ids
// ---------------------------------------------------------------------------

const ROW_DRAFT = "job-draft";
const ROW_REMINDER = "job-reminder";
const ROW_CLOSE = "job-close";
const ROW_ROLLOVER = "job-rollover";

// ---------------------------------------------------------------------------
// Constants — misc
// ---------------------------------------------------------------------------

const SPINNER_TEST_ID = "spinner";
const EXPECTED_ONE_SPINNER = 1;
const CANT_BE_UNDONE = /undone/i;

// Inline result strings the component derives from success bodies.
const DRAFTED_RESULT = "Drafted 4 questions";
const REMINDED_RESULT = "Reminded 3 players";
const WEEK_CLOSED_RESULT = "Week closed and results sent";
const NO_OPEN_WEEK_RESULT = "No open week to close";
const SEASON_ROLLED_RESULT = "Season rolled over";
const NO_SEASON_RESULT = "No current season to roll over";

// The four triggers paired with their endpoint + row.
const SAFE_ACTIONS = [
  { label: DRAFT_LABEL, endpoint: DRAFT_ENDPOINT, row: ROW_DRAFT },
  { label: REMINDER_LABEL, endpoint: REMINDER_ENDPOINT, row: ROW_REMINDER },
] as const;

const DESTRUCTIVE_ACTIONS = [
  { label: CLOSE_LABEL, endpoint: CLOSE_ENDPOINT, row: ROW_CLOSE },
  { label: ROLLOVER_LABEL, endpoint: ROLLOVER_ENDPOINT, row: ROW_ROLLOVER },
] as const;

const ALL_LABELS = [
  DRAFT_LABEL,
  REMINDER_LABEL,
  CLOSE_LABEL,
  ROLLOVER_LABEL,
] as const;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// ---------------------------------------------------------------------------
// Fetch helpers (mirrors AdminQuestionReview.test.tsx)
// ---------------------------------------------------------------------------

type MockResponseInit = { ok: boolean; json: () => Promise<unknown> };

const mockFetch = (impl: () => Promise<MockResponseInit>) => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<MockResponseInit>>(impl);
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

const okBody = (body: unknown): (() => Promise<MockResponseInit>) => () =>
  Promise.resolve({ ok: true, json: async () => body });

const failureResponse = (errorMessage = "nope"): Promise<MockResponseInit> =>
  Promise.resolve({ ok: false, json: async () => ({ error: errorMessage }) });

/**
 * A manually-resolvable fetch. Lets a test assert the in-flight confirm-button
 * spinner BEFORE resolving.
 */
const createDeferredFetch = (response: MockResponseInit) => {
  let resolveFetch!: () => void;
  const pending = new Promise<void>((resolve) => {
    resolveFetch = resolve;
  });
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<MockResponseInit>>(
    () => pending.then(() => response),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, resolve: resolveFetch };
};

const successToast = () => within(screen.getByRole("region")).getByRole("status");

// Renders the component inside the toast context so success toasts can be
// asserted via role="status" inside the polite live region.
const renderWithToasts = () =>
  render(
    <ToastProvider>
      <AdminJobControls />
      <ToastViewport />
    </ToastProvider>,
  );

// Returns a scoped query set for one operation's row.
const rowOf = (testId: string) => within(screen.getByTestId(testId));

// The open confirm dialog.
const dialog = () => screen.getByRole("dialog");

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  refresh.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

describe("AdminJobControls: rendering", () => {
  it("renders the four trigger buttons and no dialog before any interaction", () => {
    mockFetch(okBody({ ok: true }));
    render(<AdminJobControls />);

    for (const label of ALL_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: DRAFT_LABEL })).toBeInTheDocument();
    // No dialog is present before any destructive trigger is clicked.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders a data-testid row container for every operation", () => {
    mockFetch(okBody({ ok: true }));
    render(<AdminJobControls />);

    for (const row of [ROW_DRAFT, ROW_REMINDER, ROW_CLOSE, ROW_ROLLOVER]) {
      expect(screen.getByTestId(row)).toBeInTheDocument();
    }
  });
});

// ---------------------------------------------------------------------------
// SAFE actions — POST immediately, no dialog
// ---------------------------------------------------------------------------

describe("AdminJobControls: safe actions POST immediately", () => {
  for (const { label, endpoint } of SAFE_ACTIONS) {
    it(`POSTs to ${endpoint} immediately (no dialog) when "${label}" is clicked`, async () => {
      const fetchMock = mockFetch(okBody({ ok: true }));
      const user = userEvent.setup();
      render(<AdminJobControls />);

      await user.click(screen.getByRole("button", { name: label }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(endpoint);
      expect(init.method).toBe("POST");
      // No confirmation dialog is shown for safe actions.
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  }

  it("Draft next week: refreshes, toasts and shows the drafted-count result", async () => {
    mockFetch(okBody({ questionCount: 4 }));
    const user = userEvent.setup();
    renderWithToasts();

    await user.click(screen.getByRole("button", { name: DRAFT_LABEL }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
    expect(successToast()).toHaveAttribute("data-variant", "success");
    expect(rowOf(ROW_DRAFT).getByText(DRAFTED_RESULT)).toBeInTheDocument();
  });

  it("Send reminders: refreshes, toasts and shows the reminded-count result", async () => {
    mockFetch(okBody({ sent: 3 }));
    const user = userEvent.setup();
    renderWithToasts();

    await user.click(screen.getByRole("button", { name: REMINDER_LABEL }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
    expect(successToast()).toHaveAttribute("data-variant", "success");
    expect(rowOf(ROW_REMINDER).getByText(REMINDED_RESULT)).toBeInTheDocument();
  });

  it("surfaces a non-ok { error } via role=alert in the row and does not refresh", async () => {
    const errorMessage = "Draft failed upstream.";
    mockFetch(() => failureResponse(errorMessage));
    const user = userEvent.setup();
    render(<AdminJobControls />);

    await user.click(screen.getByRole("button", { name: DRAFT_LABEL }));

    await waitFor(() => {
      expect(rowOf(ROW_DRAFT).getByRole("alert")).toBeInTheDocument();
    });
    expect(rowOf(ROW_DRAFT).getByRole("alert").textContent).toContain(errorMessage);
    expect(refresh).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DESTRUCTIVE actions — confirm dialog gates the POST
// ---------------------------------------------------------------------------

describe("AdminJobControls: destructive actions open a confirm dialog", () => {
  for (const { label } of DESTRUCTIVE_ACTIONS) {
    it(`"${label}" opens a warning dialog and does NOT fetch until confirmed`, async () => {
      const fetchMock = mockFetch(okBody({ ok: true }));
      const user = userEvent.setup();
      render(<AdminJobControls />);

      await user.click(screen.getByRole("button", { name: label }));

      // Dialog appears; nothing has been POSTed yet.
      const dlg = dialog();
      expect(dlg).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();

      // It contains a confirm button, a Cancel button and an "undone" warning.
      expect(
        within(dlg).getByRole("button", { name: label }),
      ).toBeInTheDocument();
      expect(
        within(dlg).getByRole("button", { name: CANCEL_LABEL }),
      ).toBeInTheDocument();
      expect(within(dlg).getByText(CANT_BE_UNDONE)).toBeInTheDocument();
    });
  }

  for (const { label } of DESTRUCTIVE_ACTIONS) {
    it(`Cancel on "${label}" closes the dialog without fetching or refreshing`, async () => {
      const fetchMock = mockFetch(okBody({ ok: true }));
      const user = userEvent.setup();
      render(<AdminJobControls />);

      await user.click(screen.getByRole("button", { name: label }));
      await user.click(
        within(dialog()).getByRole("button", { name: CANCEL_LABEL }),
      );

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    });
  }

  for (const { label } of DESTRUCTIVE_ACTIONS) {
    it(`Escape on "${label}" cancels the dialog without fetching`, async () => {
      const fetchMock = mockFetch(okBody({ ok: true }));
      const user = userEvent.setup();
      render(<AdminJobControls />);

      await user.click(screen.getByRole("button", { name: label }));
      await user.keyboard("{Escape}");

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  for (const { label, endpoint } of DESTRUCTIVE_ACTIONS) {
    it(`confirming "${label}" POSTs to ${endpoint} and closes the dialog`, async () => {
      const fetchMock = mockFetch(okBody({ closed: true, rolledOver: true }));
      const user = userEvent.setup();
      render(<AdminJobControls />);

      await user.click(screen.getByRole("button", { name: label }));
      await user.click(within(dialog()).getByRole("button", { name: label }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(endpoint);
      expect(init.method).toBe("POST");

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
    });
  }
});

// ---------------------------------------------------------------------------
// DESTRUCTIVE results — inline summaries for both truthy/falsey outcomes
// ---------------------------------------------------------------------------

describe("AdminJobControls: close current week results", () => {
  it("shows 'Week closed and results sent' when { closed: true }, refreshes + toasts", async () => {
    mockFetch(okBody({ closed: true }));
    const user = userEvent.setup();
    renderWithToasts();

    await user.click(screen.getByRole("button", { name: CLOSE_LABEL }));
    await user.click(within(dialog()).getByRole("button", { name: CLOSE_LABEL }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
    expect(successToast()).toHaveAttribute("data-variant", "success");
    expect(rowOf(ROW_CLOSE).getByText(WEEK_CLOSED_RESULT)).toBeInTheDocument();
  });

  it("shows 'No open week to close' when { closed: false }", async () => {
    mockFetch(okBody({ closed: false }));
    const user = userEvent.setup();
    renderWithToasts();

    await user.click(screen.getByRole("button", { name: CLOSE_LABEL }));
    await user.click(within(dialog()).getByRole("button", { name: CLOSE_LABEL }));

    await waitFor(() => {
      expect(rowOf(ROW_CLOSE).getByText(NO_OPEN_WEEK_RESULT)).toBeInTheDocument();
    });
  });
});

describe("AdminJobControls: roll over season results", () => {
  it("shows 'Season rolled over' when { rolledOver: true }, refreshes + toasts", async () => {
    mockFetch(okBody({ rolledOver: true }));
    const user = userEvent.setup();
    renderWithToasts();

    await user.click(screen.getByRole("button", { name: ROLLOVER_LABEL }));
    await user.click(within(dialog()).getByRole("button", { name: ROLLOVER_LABEL }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
    expect(successToast()).toHaveAttribute("data-variant", "success");
    expect(rowOf(ROW_ROLLOVER).getByText(SEASON_ROLLED_RESULT)).toBeInTheDocument();
  });

  it("shows 'No current season to roll over' when { rolledOver: false }", async () => {
    mockFetch(okBody({ rolledOver: false }));
    const user = userEvent.setup();
    renderWithToasts();

    await user.click(screen.getByRole("button", { name: ROLLOVER_LABEL }));
    await user.click(within(dialog()).getByRole("button", { name: ROLLOVER_LABEL }));

    await waitFor(() => {
      expect(rowOf(ROW_ROLLOVER).getByText(NO_SEASON_RESULT)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// DESTRUCTIVE — in-flight spinner on the confirm button + error path
// ---------------------------------------------------------------------------

describe("AdminJobControls: confirmed request in flight", () => {
  it("shows the loading spinner on the confirm button while the POST is pending", async () => {
    const { resolve } = createDeferredFetch({ ok: true, json: async () => ({ closed: true }) });
    const user = userEvent.setup();
    render(<AdminJobControls />);

    await user.click(screen.getByRole("button", { name: CLOSE_LABEL }));
    await user.click(within(dialog()).getByRole("button", { name: CLOSE_LABEL }));

    await waitFor(() => {
      expect(
        within(dialog()).getByRole("button", { name: CLOSE_LABEL }),
      ).toHaveAttribute("aria-busy", "true");
    });
    expect(screen.getAllByTestId(SPINNER_TEST_ID)).toHaveLength(EXPECTED_ONE_SPINNER);

    resolve();

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("surfaces a non-ok { error } from a confirmed POST via role=alert and does not refresh", async () => {
    const errorMessage = "Rollover blocked: season still active.";
    mockFetch(() => failureResponse(errorMessage));
    const user = userEvent.setup();
    render(<AdminJobControls />);

    await user.click(screen.getByRole("button", { name: ROLLOVER_LABEL }));
    await user.click(within(dialog()).getByRole("button", { name: ROLLOVER_LABEL }));

    await waitFor(() => {
      expect(rowOf(ROW_ROLLOVER).getByRole("alert")).toBeInTheDocument();
    });
    expect(rowOf(ROW_ROLLOVER).getByRole("alert").textContent).toContain(errorMessage);
    expect(refresh).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Independence — one action's result/error never leaks into another row
// ---------------------------------------------------------------------------

describe("AdminJobControls: row independence", () => {
  it("a successful Draft result does not populate the reminder row", async () => {
    mockFetch(okBody({ questionCount: 4 }));
    const user = userEvent.setup();
    renderWithToasts();

    await user.click(screen.getByRole("button", { name: DRAFT_LABEL }));

    await waitFor(() => {
      expect(rowOf(ROW_DRAFT).getByText(DRAFTED_RESULT)).toBeInTheDocument();
    });
    // The reminder row shows neither the drafted result nor its own result.
    expect(rowOf(ROW_REMINDER).queryByText(DRAFTED_RESULT)).toBeNull();
    expect(rowOf(ROW_REMINDER).queryByText(REMINDED_RESULT)).toBeNull();
  });

  it("a Draft error alert appears only in the draft row, not the reminder row", async () => {
    const errorMessage = "Draft failed upstream.";
    mockFetch(() => failureResponse(errorMessage));
    const user = userEvent.setup();
    render(<AdminJobControls />);

    await user.click(screen.getByRole("button", { name: DRAFT_LABEL }));

    await waitFor(() => {
      expect(rowOf(ROW_DRAFT).getByRole("alert")).toBeInTheDocument();
    });
    expect(rowOf(ROW_REMINDER).queryByRole("alert")).toBeNull();
  });
});
