/**
 * Toast system tests.
 *
 * ---------------------------------------------------------------------------
 * Contract decisions documented for the code-writer
 * ---------------------------------------------------------------------------
 * New file: components/Toast.tsx
 *
 * Exports:
 *   - ToastProvider({ children })  — client context provider holding the
 *     active toast list.
 *   - useToast() -> { success(message: string): void; error(message: string): void }
 *     Must THROW when called outside a <ToastProvider>.
 *   - ToastViewport()             — renders the active toasts.
 *       * container:  role="region", aria-live="polite"
 *       * each toast: role="status", carries the message text, a
 *         data-variant of "success" | "error", and a dismiss <button> with an
 *         accessible name like "Dismiss".
 *   - TOAST_DURATION_MS (number)  — auto-dismiss duration in milliseconds,
 *     imported here so the auto-dismiss test advances by the exact amount.
 * ---------------------------------------------------------------------------
 */

import { render, screen, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import {
  ToastProvider,
  ToastViewport,
  useToast,
  TOAST_DURATION_MS,
} from "@/components/Toast";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUCCESS_VARIANT = "success";
const ERROR_VARIANT = "error";

const SAVED_MESSAGE = "Saved";
const OOPS_MESSAGE = "Oops";
const FIRST_MESSAGE = "First toast";
const SECOND_MESSAGE = "Second toast";

const DISMISS_LABEL = /dismiss/i;

const EXPECTED_TWO_TOASTS = 2;
const PAST_DURATION_MS = TOAST_DURATION_MS + 1;

// ---------------------------------------------------------------------------
// Harness: a tiny component that fires toasts via useToast() on demand
// ---------------------------------------------------------------------------

type ToastCall =
  | { variant: "success"; message: string }
  | { variant: "error"; message: string };

/**
 * Renders trigger buttons plus, optionally, an "on mount" call so timer tests
 * can fire a single toast deterministically without user-event.
 */
function ToastHarness({ onMount }: { onMount?: ToastCall }) {
  const toast = useToast();

  useEffect(() => {
    if (!onMount) {
      return;
    }
    if (onMount.variant === "success") {
      toast.success(onMount.message);
    } else {
      toast.error(onMount.message);
    }
    // Fire exactly once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <button type="button" onClick={() => toast.success(SAVED_MESSAGE)}>
        fire-success
      </button>
      <button type="button" onClick={() => toast.error(OOPS_MESSAGE)}>
        fire-error
      </button>
      <button type="button" onClick={() => toast.success(FIRST_MESSAGE)}>
        fire-first
      </button>
      <button type="button" onClick={() => toast.success(SECOND_MESSAGE)}>
        fire-second
      </button>
    </div>
  );
}

const renderHarness = (onMount?: ToastCall) =>
  render(
    <ToastProvider>
      <ToastHarness onMount={onMount} />
      <ToastViewport />
    </ToastProvider>,
  );

/** Synchronously click a harness button, wrapped in act(). */
const clickButton = (label: string) => {
  act(() => {
    screen.getByText(label).click();
  });
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// success / error variants
// ---------------------------------------------------------------------------

describe("Toast: variants", () => {
  it("renders a success toast with the message text and data-variant='success'", () => {
    renderHarness();

    clickButton("fire-success");

    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent(SAVED_MESSAGE);
    expect(toast).toHaveAttribute("data-variant", SUCCESS_VARIANT);
  });

  it("renders an error toast with data-variant='error'", () => {
    renderHarness();

    clickButton("fire-error");

    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent(OOPS_MESSAGE);
    expect(toast).toHaveAttribute("data-variant", ERROR_VARIANT);
  });
});

// ---------------------------------------------------------------------------
// viewport region
// ---------------------------------------------------------------------------

describe("Toast: viewport region", () => {
  it("renders a polite live region container", () => {
    renderHarness();

    const region = screen.getByRole("region");
    expect(region).toHaveAttribute("aria-live", "polite");
  });
});

// ---------------------------------------------------------------------------
// stacking
// ---------------------------------------------------------------------------

describe("Toast: stacking", () => {
  it("stacks multiple toasts as separate role='status' nodes", () => {
    renderHarness();

    clickButton("fire-first");
    clickButton("fire-second");

    const toasts = screen.getAllByRole("status");
    expect(toasts).toHaveLength(EXPECTED_TWO_TOASTS);
    expect(screen.getByText(FIRST_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText(SECOND_MESSAGE)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// manual dismiss
// ---------------------------------------------------------------------------

describe("Toast: manual dismiss", () => {
  it("removes a toast when its dismiss control is clicked", () => {
    renderHarness();

    clickButton("fire-success");
    expect(screen.getByRole("status")).toBeInTheDocument();

    const dismiss = screen.getByRole("button", { name: DISMISS_LABEL });
    act(() => {
      dismiss.click();
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// auto-dismiss (fake timers)
// ---------------------------------------------------------------------------

describe("Toast: auto-dismiss", () => {
  it("auto-dismisses a toast after TOAST_DURATION_MS", () => {
    vi.useFakeTimers();

    // Fire the toast on mount so no user-event (which needs real timers) is used.
    renderHarness({ variant: "success", message: SAVED_MESSAGE });

    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(PAST_DURATION_MS);
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// guard: useToast() outside a provider
// ---------------------------------------------------------------------------

describe("Toast: provider guard", () => {
  it("throws when useToast() is called outside a ToastProvider", () => {
    // Silence the expected React error boundary console noise.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<ToastHarness />)).toThrow();

    errorSpy.mockRestore();
  });
});
