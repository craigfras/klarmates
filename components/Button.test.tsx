/**
 * Button (loading button) tests.
 *
 * ---------------------------------------------------------------------------
 * Contract decisions documented for the code-writer
 * ---------------------------------------------------------------------------
 * New file: components/Button.tsx
 *
 * Exports:
 *   Button(props) where
 *     props = React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }
 *
 * Behaviour:
 *   - Renders its children as the label.
 *   - loading === true:
 *       * the button is `disabled`
 *       * the button has aria-busy="true"
 *       * a spinner element with data-testid="spinner" is rendered
 *   - loading falsy:
 *       * not disabled (unless `disabled` prop is passed)
 *       * no aria-busy="true"
 *       * no spinner
 *   - An explicit `disabled` prop disables the button even when not loading.
 *   - onClick fires when clicked while enabled; arbitrary props pass through
 *     (e.g. type="submit").
 * ---------------------------------------------------------------------------
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/Button";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPINNER_TEST_ID = "spinner";
const BUTTON_LABEL = "Submit answers";
const ARIA_BUSY = "aria-busy";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// label
// ---------------------------------------------------------------------------

describe("Button: label", () => {
  it("renders its children as the button label", () => {
    render(<Button>{BUTTON_LABEL}</Button>);

    expect(screen.getByRole("button", { name: BUTTON_LABEL })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// loading state
// ---------------------------------------------------------------------------

describe("Button: loading state", () => {
  it("is disabled, marked aria-busy, and shows a spinner when loading", () => {
    render(<Button loading>{BUTTON_LABEL}</Button>);

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(ARIA_BUSY, "true");
    expect(screen.getByTestId(SPINNER_TEST_ID)).toBeInTheDocument();
  });

  it("is enabled, not aria-busy, and shows no spinner when not loading", () => {
    render(<Button>{BUTTON_LABEL}</Button>);

    const button = screen.getByRole("button");
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute(ARIA_BUSY, "true");
    expect(screen.queryByTestId(SPINNER_TEST_ID)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// explicit disabled
// ---------------------------------------------------------------------------

describe("Button: explicit disabled", () => {
  it("is disabled when the disabled prop is passed even though loading is false", () => {
    render(
      <Button disabled loading={false}>
        {BUTTON_LABEL}
      </Button>,
    );

    expect(screen.getByRole("button")).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// onClick + prop pass-through
// ---------------------------------------------------------------------------

describe("Button: interaction and prop pass-through", () => {
  it("fires onClick when clicked while enabled and not loading", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>{BUTTON_LABEL}</Button>);

    await user.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick while loading (button is disabled)", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button loading onClick={onClick}>
        {BUTTON_LABEL}
      </Button>,
    );

    await user.click(screen.getByRole("button"));

    expect(onClick).not.toHaveBeenCalled();
  });

  it("passes through arbitrary props such as type='submit'", () => {
    render(<Button type="submit">{BUTTON_LABEL}</Button>);

    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });
});
