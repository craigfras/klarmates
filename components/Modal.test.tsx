import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "@/components/Modal";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TITLE = "Week complete";
const BODY_TEXT = "You scored 3 of 4.";
const DEFAULT_OK_LABEL = "OK";
const CUSTOM_OK_LABEL = "Go home";
const EXPECTED_ONE_CALL = 1;

// ---------------------------------------------------------------------------
// Closed state
// ---------------------------------------------------------------------------

describe("Modal: closed", () => {
  it("renders nothing when open is false", () => {
    render(
      <Modal open={false} title={TITLE} onOk={vi.fn()}>
        {BODY_TEXT}
      </Modal>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(BODY_TEXT)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Open state: dialog, accessible name, body, OK button
// ---------------------------------------------------------------------------

describe("Modal: open", () => {
  it("renders a dialog whose accessible name is the title, with the body and an OK button", () => {
    render(
      <Modal open title={TITLE} onOk={vi.fn()}>
        {BODY_TEXT}
      </Modal>,
    );

    // The dialog is present and is a modal whose accessible name is the title.
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName(TITLE);

    // The body content is rendered inside.
    expect(screen.getByText(BODY_TEXT)).toBeInTheDocument();

    // A default-labelled OK button is present.
    expect(
      screen.getByRole("button", { name: DEFAULT_OK_LABEL }),
    ).toBeInTheDocument();
  });

  it("uses a custom okLabel when provided", () => {
    render(
      <Modal open title={TITLE} okLabel={CUSTOM_OK_LABEL} onOk={vi.fn()}>
        {BODY_TEXT}
      </Modal>,
    );

    expect(
      screen.getByRole("button", { name: CUSTOM_OK_LABEL }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// OK interaction
// ---------------------------------------------------------------------------

describe("Modal: OK", () => {
  it("calls onOk once when the OK button is clicked", async () => {
    const onOk = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal open title={TITLE} onOk={onOk}>
        {BODY_TEXT}
      </Modal>,
    );

    await user.click(screen.getByRole("button", { name: DEFAULT_OK_LABEL }));

    expect(onOk).toHaveBeenCalledTimes(EXPECTED_ONE_CALL);
  });
});
