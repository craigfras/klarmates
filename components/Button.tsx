"use client";

/**
 * Button — a thin presentational button with an optional loading state.
 *
 * When loading it disables itself, marks aria-busy, and renders an inline
 * spinner before the label. All other props pass straight through to the
 * native <button>. No logic beyond that.
 */

import type { ButtonHTMLAttributes, Ref } from "react";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

export function Button({ loading, disabled, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={loading || disabled}
      aria-busy={loading ? true : undefined}
    >
      {loading && <span data-testid="spinner" className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
