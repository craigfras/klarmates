/**
 * Tests for the RestartWeekButton client component.
 *
 * RestartWeekButton({ weekId }) renders an admin button that POSTs to
 * /api/admin/week/restart with { weekId }, shows the shared Button's loading
 * spinner while the request is in flight, raises a success toast and refreshes
 * the route on success, and raises an error toast (recovering the button) on
 * failure. Rendering + tiny state only — no business logic.
 *
 * Mirrors the AnswerForm test patterns: mocked global.fetch, mocked
 * next/navigation useRouter().refresh, and the shared <ToastProvider> /
 * <ToastViewport> harness with toasts asserted in the role="region" viewport.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RestartWeekButton } from "@/components/RestartWeekButton";
import { ToastProvider, ToastViewport } from "@/components/Toast";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEEK_ID = "week-2026-25";
const RESTART_ENDPOINT = "/api/admin/week/restart";
const SPINNER_TEST_ID = "spinner";
const RESTART_LABEL_PATTERN = /restart/i;
const SUCCESS_VARIANT = "success";
const ERROR_VARIANT = "error";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

const mockFetch = (impl: () => Promise<unknown>) => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<unknown>>(
    impl,
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

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

const renderWithToasts = () =>
  render(
    <ToastProvider>
      <RestartWeekButton weekId={WEEK_ID} />
      <ToastViewport />
    </ToastProvider>,
  );

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

describe("RestartWeekButton: rendering", () => {
  it("renders a button labeled /restart/i", () => {
    mockFetch(async () => ({ ok: true, json: async () => ({}) }));
    render(<RestartWeekButton weekId={WEEK_ID} />);

    expect(
      screen.getByRole("button", { name: RESTART_LABEL_PATTERN }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// POST + in-flight spinner
// ---------------------------------------------------------------------------

describe("RestartWeekButton: posts and shows the spinner while pending", () => {
  it("POSTs to /api/admin/week/restart with the weekId in the body", async () => {
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({}),
    }));
    const user = userEvent.setup();
    render(<RestartWeekButton weekId={WEEK_ID} />);

    await user.click(screen.getByRole("button", { name: RESTART_LABEL_PATTERN }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(RESTART_ENDPOINT);
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.weekId).toBe(WEEK_ID);
  });

  it("shows the spinner (aria-busy + disabled) while the POST is pending", async () => {
    const { resolve } = createDeferredFetch({ ok: true, json: async () => ({}) });
    const user = userEvent.setup();
    renderWithToasts();

    await user.click(screen.getByRole("button", { name: RESTART_LABEL_PATTERN }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: RESTART_LABEL_PATTERN }),
      ).toHaveAttribute("aria-busy", "true");
    });
    expect(
      screen.getByRole("button", { name: RESTART_LABEL_PATTERN }),
    ).toBeDisabled();
    expect(screen.getByTestId(SPINNER_TEST_ID)).toBeInTheDocument();

    // Let the request finish.
    resolve();
  });
});

// ---------------------------------------------------------------------------
// success: toast + router.refresh
// ---------------------------------------------------------------------------

describe("RestartWeekButton: successful restart", () => {
  it("raises a success toast (text /restart/i) in the viewport region", async () => {
    const { resolve } = createDeferredFetch({ ok: true, json: async () => ({}) });
    const user = userEvent.setup();
    renderWithToasts();

    await user.click(screen.getByRole("button", { name: RESTART_LABEL_PATTERN }));
    resolve();

    const viewport = await screen.findByRole("region");
    await waitFor(() => {
      const status = within(viewport).getByRole("status");
      expect(status).toHaveAttribute("data-variant", SUCCESS_VARIANT);
      expect(status).toHaveTextContent(RESTART_LABEL_PATTERN);
    });
  });

  it("calls router.refresh() on success", async () => {
    const { resolve } = createDeferredFetch({ ok: true, json: async () => ({}) });
    const user = userEvent.setup();
    renderWithToasts();

    await user.click(screen.getByRole("button", { name: RESTART_LABEL_PATTERN }));
    resolve();

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// failure: error toast + button recovers
// ---------------------------------------------------------------------------

describe("RestartWeekButton: failed restart", () => {
  it("raises an error toast when the response is not ok", async () => {
    const { resolve } = createDeferredFetch({ ok: false, json: async () => ({}) });
    const user = userEvent.setup();
    renderWithToasts();

    await user.click(screen.getByRole("button", { name: RESTART_LABEL_PATTERN }));
    resolve();

    const viewport = await screen.findByRole("region");
    await waitFor(() => {
      expect(within(viewport).getByRole("status")).toHaveAttribute(
        "data-variant",
        ERROR_VARIANT,
      );
    });
  });

  it("recovers the button (not disabled / not aria-busy / spinner gone) after failure", async () => {
    mockFetch(async () => ({ ok: false, json: async () => ({}) }));
    const user = userEvent.setup();
    renderWithToasts();

    await user.click(screen.getByRole("button", { name: RESTART_LABEL_PATTERN }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: RESTART_LABEL_PATTERN }),
      ).not.toHaveAttribute("aria-busy", "true");
    });
    expect(
      screen.getByRole("button", { name: RESTART_LABEL_PATTERN }),
    ).not.toBeDisabled();
    expect(screen.queryByTestId(SPINNER_TEST_ID)).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
