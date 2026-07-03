"use client";

/**
 * ConfirmDialog — an accessible confirm/cancel dialog for destructive actions.
 *
 * Rendering only: when closed it renders nothing; when open it renders a
 * backdrop + a labelled dialog whose body is the supplied children, a confirm
 * button (the shared Button, named by `confirmLabel`) and a Cancel button.
 * Unlike Modal, the safe default is inverted for consequence: focus lands on
 * Cancel, and Escape / backdrop clicks map to Cancel — never Confirm. No
 * business logic lives here.
 */

import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/Button";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CANCEL_LABEL = "Cancel";
const ESCAPE_KEY = "Escape";
const BACKDROP_TEST_ID = "confirm-backdrop";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  confirmLabel: string;
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: React.ReactNode;
};

export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  confirming = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  // --- Move focus to Cancel when the dialog opens (safe default) ---------
  useEffect(() => {
    if (open) {
      cancelRef.current?.focus();
    }
  }, [open]);

  // --- Escape maps to Cancel while open (safety inversion vs Modal) ------
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === ESCAPE_KEY) {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  // --- Backdrop click (outside the dialog) maps to Cancel ----------------
  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onCancel();
    }
  };

  // --- Render: backdrop + labelled dialog --------------------------------
  return (
    <div
      className="modal-backdrop"
      data-testid={BACKDROP_TEST_ID}
      onClick={handleBackdropClick}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 className="modal-title" id={titleId}>
          {title}
        </h2>
        <div className="modal-body">{children}</div>
        <div className="confirm-dialog-actions">
          <Button
            ref={cancelRef}
            type="button"
            className="confirm-cancel-btn"
            onClick={onCancel}
          >
            {CANCEL_LABEL}
          </Button>
          <Button
            type="button"
            className="confirm-confirm-btn"
            loading={confirming}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
