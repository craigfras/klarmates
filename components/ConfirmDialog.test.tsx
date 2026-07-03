/**
 * ConfirmDialog component tests.
 *
 * ---------------------------------------------------------------------------
 * Contract decisions documented for the code-writer
 * ---------------------------------------------------------------------------
 * A "use client" accessible confirm/cancel dialog for destructive actions.
 *
 * Props:
 *   {
 *     open: boolean;
 *     title: string;
 *     confirmLabel: string;
 *     confirming?: boolean;
 *     onConfirm: () => void;
 *     onCancel: () => void;
 *     children: React.ReactNode;
 *   }
 *
 * Rendering (mirrors Modal.tsx conventions):
 *   - open=false  → renders nothing (no role="dialog").
 *   - open=true   → renders an outer overlay backdrop with
 *       data-testid="confirm-backdrop" wrapping a role="dialog" element that
 *       has aria-modal="true" and aria-labelledby pointing at the title
 *       element (so the dialog's accessible name is `title`).
 *   - The dialog renders the `title`, the `children` (body/description), a
 *     confirm <Button> whose accessible name is `confirmLabel`, and a
 *     "Cancel" <Button>.
 *
 * Focus (safe default for destructive dialogs):
 *   - On open, focus moves to the CANCEL button (NOT confirm).
 *
 * Interaction:
 *   - Clicking confirm → onConfirm once, onCancel never.
 *   - Clicking Cancel  → onCancel once, onConfirm never.
 *   - Escape while open → onCancel (the key safety difference vs Modal, which
 *     mirrors OK on Escape).
 *   - Clicking the backdrop (outside the dialog) → onCancel.
 *   - Clicking inside the dialog → does NOT call onCancel.
 *
 * Loading:
 *   - confirming=true → the confirm button shows the Button loading state
 *     (aria-busy="true" + exactly one spinner) and is disabled; a second click
 *     while confirming does not fire onConfirm again.
 *
 * Pre-implementation the ConfirmDialog module does not exist, so the import
 * fails to resolve and every test fails for that reason until it is written.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/components/ConfirmDialog";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TITLE = "Close current week";
const CONFIRM_LABEL = "Close week";
const CANCEL_LABEL = "Cancel";
const BODY_TEXT = "This ends the week and sends results. It can't be undone.";

const BACKDROP_TEST_ID = "confirm-backdrop";
const SPINNER_TEST_ID = "spinner";
const EXPECTED_ONE_SPINNER = 1;
const EXPECTED_ONE_CALL = 1;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Closed state
// ---------------------------------------------------------------------------

describe("ConfirmDialog: closed", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        title={TITLE}
        confirmLabel={CONFIRM_LABEL}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      >
        {BODY_TEXT}
      </ConfirmDialog>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(BODY_TEXT)).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});

// ---------------------------------------------------------------------------
// Open state: dialog, accessible name, body, confirm + cancel buttons
// ---------------------------------------------------------------------------

describe("ConfirmDialog: open", () => {
  it("renders a modal dialog labelled by the title, with body, confirm and Cancel buttons", () => {
    render(
      <ConfirmDialog
        open
        title={TITLE}
        confirmLabel={CONFIRM_LABEL}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      >
        {BODY_TEXT}
      </ConfirmDialog>,
    );

    // The dialog is present and is a modal whose accessible name is the title.
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby");
    expect(dialog).toHaveAccessibleName(TITLE);

    // The body content is rendered inside.
    expect(screen.getByText(BODY_TEXT)).toBeInTheDocument();

    // A confirm button (named confirmLabel) and a Cancel button are present.
    expect(
      screen.getByRole("button", { name: CONFIRM_LABEL }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: CANCEL_LABEL }),
    ).toBeInTheDocument();
  });

  it("moves focus to the Cancel button on open (safe default)", () => {
    render(
      <ConfirmDialog
        open
        title={TITLE}
        confirmLabel={CONFIRM_LABEL}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      >
        {BODY_TEXT}
      </ConfirmDialog>,
    );

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: CANCEL_LABEL }),
    );
  });
});

// ---------------------------------------------------------------------------
// Confirm / Cancel interaction
// ---------------------------------------------------------------------------

describe("ConfirmDialog: confirm and cancel", () => {
  it("calls onConfirm once (never onCancel) when the confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        title={TITLE}
        confirmLabel={CONFIRM_LABEL}
        onConfirm={onConfirm}
        onCancel={onCancel}
      >
        {BODY_TEXT}
      </ConfirmDialog>,
    );

    await user.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    expect(onConfirm).toHaveBeenCalledTimes(EXPECTED_ONE_CALL);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel once (never onConfirm) when Cancel is clicked", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        title={TITLE}
        confirmLabel={CONFIRM_LABEL}
        onConfirm={onConfirm}
        onCancel={onCancel}
      >
        {BODY_TEXT}
      </ConfirmDialog>,
    );

    await user.click(screen.getByRole("button", { name: CANCEL_LABEL }));

    expect(onCancel).toHaveBeenCalledTimes(EXPECTED_ONE_CALL);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Escape → cancel (safety difference vs Modal)
// ---------------------------------------------------------------------------

describe("ConfirmDialog: Escape", () => {
  it("calls onCancel (NOT onConfirm) when Escape is pressed while open", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        title={TITLE}
        confirmLabel={CONFIRM_LABEL}
        onConfirm={onConfirm}
        onCancel={onCancel}
      >
        {BODY_TEXT}
      </ConfirmDialog>,
    );

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledTimes(EXPECTED_ONE_CALL);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Backdrop click → cancel; inside click → no cancel
// ---------------------------------------------------------------------------

describe("ConfirmDialog: backdrop", () => {
  it("calls onCancel when the backdrop (outside the dialog) is clicked", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        title={TITLE}
        confirmLabel={CONFIRM_LABEL}
        onConfirm={onConfirm}
        onCancel={onCancel}
      >
        {BODY_TEXT}
      </ConfirmDialog>,
    );

    await user.click(screen.getByTestId(BACKDROP_TEST_ID));

    expect(onCancel).toHaveBeenCalledTimes(EXPECTED_ONE_CALL);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does NOT call onCancel when a click lands inside the dialog", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        title={TITLE}
        confirmLabel={CONFIRM_LABEL}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      >
        {BODY_TEXT}
      </ConfirmDialog>,
    );

    // A click on the dialog body/title (inside the dialog) must not cancel.
    await user.click(screen.getByText(BODY_TEXT));

    expect(onCancel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Confirming (loading) state
// ---------------------------------------------------------------------------

describe("ConfirmDialog: confirming", () => {
  it("shows the loading state on the confirm button and disables it while confirming", () => {
    render(
      <ConfirmDialog
        open
        title={TITLE}
        confirmLabel={CONFIRM_LABEL}
        confirming
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      >
        {BODY_TEXT}
      </ConfirmDialog>,
    );

    const confirmButton = screen.getByRole("button", { name: CONFIRM_LABEL });
    expect(confirmButton).toHaveAttribute("aria-busy", "true");
    expect(confirmButton).toBeDisabled();
    expect(screen.getAllByTestId(SPINNER_TEST_ID)).toHaveLength(
      EXPECTED_ONE_SPINNER,
    );
  });

  it("does not fire onConfirm again on a second click while confirming", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        title={TITLE}
        confirmLabel={CONFIRM_LABEL}
        confirming
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      >
        {BODY_TEXT}
      </ConfirmDialog>,
    );

    await user.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
